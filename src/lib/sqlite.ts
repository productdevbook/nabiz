import type { Db, Stmt } from "./db.ts"

/** The slice of bun:sqlite and node:sqlite that both spell the same way.
 *  Neither is a dependency: whichever runtime is running provides it. */
interface Driver {
  exec(sql: string): void
  prepare(sql: string): Prepared
  close(): void
}

interface Prepared {
  all(...args: unknown[]): unknown[]
  run(...args: unknown[]): { changes?: number | bigint }
}

interface Bound extends Stmt {
  sql: string
  args: unknown[]
}

export interface SqliteDb extends Db {
  exec(sql: string): Promise<void>
  close(): Promise<void>
}

// WAL so a read during a write is not a locked database; a wait rather
// than an error when two writes do meet.
const PRAGMAS = [
  "PRAGMA journal_mode = WAL",
  "PRAGMA busy_timeout = 5000",
  "PRAGMA synchronous = NORMAL",
]

const changesOf = (r: { changes?: number | bigint }): number => Number(r.changes ?? 0)

async function open(path: string): Promise<Driver> {
  const runtime = (globalThis as { process?: { versions?: { bun?: string } } }).process
  const name = runtime?.versions?.bun === undefined ? "node:sqlite" : "bun:sqlite"
  const mod = (await import(/* @vite-ignore */ name)) as {
    Database?: new (file: string) => Driver
    DatabaseSync?: new (file: string) => Driver
  }
  const Database = mod.Database ?? mod.DatabaseSync
  if (Database === undefined) throw new Error(`${name} carries no database constructor`)
  const driver = new Database(path)
  for (const pragma of PRAGMAS) driver.exec(pragma)
  return driver
}

/** The same D1 shape, backed by a file. The driver is opened on first use
 *  rather than in this function, so a page that never touches the database
 *  never pays for it — and so opening can be asynchronous while `prepare`
 *  stays the synchronous call the rest of the code makes. */
export function openSqlite(path: string): SqliteDb {
  let opening: Promise<Driver> | null = null
  const driver = (): Promise<Driver> => (opening ??= open(path))

  const cache = new Map<string, Prepared>()
  const compiled = (d: Driver, sql: string): Prepared => {
    const hit = cache.get(sql)
    if (hit !== undefined) return hit
    const made = d.prepare(sql)
    cache.set(sql, made)
    return made
  }

  function statement(sql: string, args: unknown[]): Bound {
    return {
      sql,
      args,
      bind: (...values: unknown[]) => statement(sql, values),
      all: async <T>() => ({ results: compiled(await driver(), sql).all(...args) as T[] }),
      first: async <T>() =>
        (compiled(await driver(), sql).all(...args)[0] as T | undefined) ?? null,
      run: async () => ({
        meta: { changes: changesOf(compiled(await driver(), sql).run(...args)) },
      }),
    }
  }

  return {
    prepare: (sql: string) => statement(sql, []),

    // D1 runs a batch as one transaction, and so does this — every
    // statement between BEGIN and COMMIT runs without an await between
    // them, so nothing else in the process can slip into the transaction.
    async batch<T>(statements: Stmt[]): Promise<{ results: T[] }[]> {
      const d = await driver()
      const bound = statements.map((s) => {
        const b = s as Bound
        if (typeof b.sql !== "string")
          throw new Error("a batch takes statements from this database")
        return b
      })
      d.exec("BEGIN IMMEDIATE")
      try {
        const out = bound.map((b) => ({ results: compiled(d, b.sql).all(...b.args) as T[] }))
        d.exec("COMMIT")
        return out
      } catch (error) {
        // SQLite rolls back by itself on a full disk or an I/O error, and
        // then ROLLBACK throws "no transaction is active" — which would
        // walk out of here in place of the error that says what happened.
        try {
          d.exec("ROLLBACK")
        } catch {
          /* the transaction was already gone */
        }
        throw error
      }
    },

    async exec(sql: string): Promise<void> {
      ;(await driver()).exec(sql)
    },

    async close(): Promise<void> {
      if (opening === null) return
      const d = await opening
      opening = null
      cache.clear()
      d.close()
    },
  }
}
