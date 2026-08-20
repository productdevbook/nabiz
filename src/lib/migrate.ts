import type { Db } from "./db.ts"

/** Every column added to a table that already existed, in the order they
 *  were added. `CREATE TABLE IF NOT EXISTS` cannot reach these — it is a
 *  no-op the moment the table is there — so a deployment that started on
 *  an older version needs them named. */
const ADDED: { table: string; column: string; type: string; fill?: string }[] = [
  { table: "monitors", column: "expect_body", type: "TEXT" },
  { table: "monitors", column: "fail_threshold", type: "INTEGER NOT NULL DEFAULT 2" },
  { table: "state", column: "fails", type: "INTEGER NOT NULL DEFAULT 0" },
  { table: "notices", column: "lang", type: "TEXT" },
  { table: "state", column: "last_status", type: "INTEGER" },
  { table: "state", column: "last_reason", type: "TEXT" },
  { table: "state", column: "fail_at", type: "INTEGER" },
  {
    table: "events",
    column: "grouped",
    type: "INTEGER NOT NULL DEFAULT 0",
    // The default is right for every named service and wrong for every
    // grouped one, and the rows are already there to be asked.
    fill: "UPDATE events SET grouped = 1 WHERE monitor_id IN (SELECT id FROM monitors WHERE grouped <> 0)",
  },
]

async function columns(db: Db, table: string): Promise<Set<string>> {
  const { results } = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>()
  return new Set(results.map((r) => r.name))
}

/** Brings a database up to what this version reads, and says what it had
 *  to add. Idempotent: a database that is already current is untouched,
 *  and one that predates a table is left to `schema.sql`, which creates
 *  it complete. */
export async function migrate(db: Db): Promise<string[]> {
  const tables = [...new Set(ADDED.map((a) => a.table))]
  const found = new Map(
    await Promise.all(tables.map(async (t) => [t, await columns(db, t)] as const)),
  )
  // A table with no columns is a table that does not exist yet; schema.sql
  // is about to create it, with everything in it.
  const missing = ADDED.filter((a) => {
    const has = found.get(a.table)
    return has !== undefined && has.size > 0 && !has.has(a.column)
  })
  await Promise.all(
    missing.map(async (a) => {
      await db.prepare(`ALTER TABLE ${a.table} ADD COLUMN ${a.column} ${a.type}`).run()
      // After its own ALTER, and only its own: a fill reads the column
      // that statement added.
      if (a.fill !== undefined) await db.prepare(a.fill).run()
    }),
  )
  return missing.map((a) => `${a.table}.${a.column}`)
}
