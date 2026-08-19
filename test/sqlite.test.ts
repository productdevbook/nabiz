import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

import type { Monitor } from "../src/lib/probe.ts"
import { openSqlite } from "../src/lib/sqlite.ts"
import { addNotice, forPage, monitors, notices, record, resolveNotice } from "../src/lib/store.ts"

const schema = readFileSync(new URL("../schema.sql", import.meta.url), "utf8")

async function fresh() {
  const db = openSqlite(":memory:")
  await db.exec(schema)
  return db
}

const seed = (slug: string, threshold = 2) =>
  `INSERT INTO monitors (slug, name, url, fail_threshold) VALUES ('${slug}', '${slug}', 'https://${slug}.example.com/', ${threshold})`

const result = (m: Monitor, ok: boolean) => ({ monitor: m, ok, status: ok ? 200 : null, ms: 12 })

describe("the same store, on a file instead of D1", () => {
  test("a round of results lands in checks, days and state", async () => {
    const db = await fresh()
    await db.exec(seed("api"))
    const [api] = await monitors(db)
    expect(api).toBeDefined()

    const changes = await record(db, [result(api as Monitor, true)])
    expect(changes).toEqual([])

    const data = await forPage(db, 90)
    expect(data.monitors.length).toBe(1)
    expect(data.states.get(1)?.ok).toBe(true)
    expect(data.days.get(1)?.[0]?.total).toBe(1)
    expect(data.latency.get(1)).toBe(12)
    await db.close()
  })

  test("the threshold holds across rounds, and recovery is one event", async () => {
    const db = await fresh()
    await db.exec(seed("api"))
    const [api] = await monitors(db)
    const m = api as Monitor

    await record(db, [result(m, true)])
    // One failure is weather.
    expect(await record(db, [result(m, false)])).toEqual([])
    const down = await record(db, [result(m, false)])
    expect(down.length).toBe(1)
    expect(down[0]?.ok).toBe(false)

    const up = await record(db, [result(m, true)])
    expect(up.length).toBe(1)
    expect(up[0]?.ok).toBe(true)

    const { results } = await db
      .prepare("SELECT ok FROM events ORDER BY rowid")
      .all<{ ok: number }>()
    expect(results.map((r) => r.ok)).toEqual([0, 1])
    await db.close()
  })

  test("notices are written, read and resolved", async () => {
    const db = await fresh()
    const id = await addNotice(db, "maintenance", "a window", "tr")
    expect(id).toBe(1)
    expect((await notices(db, 10, "tr")).length).toBe(1)
    // A notice written for one language does not speak to another.
    expect((await notices(db, 10, "de")).length).toBe(0)
    expect(await resolveNotice(db, id)).toBe(true)
    expect(await resolveNotice(db, id)).toBe(false)
    await db.close()
  })

  test("a batch that fails writes none of itself", async () => {
    const db = await fresh()
    await db.exec(seed("api"))
    await expect(
      db.batch([
        db.prepare("INSERT INTO events (monitor_id, at, ok) VALUES (1, 1, 1)"),
        db.prepare("INSERT INTO nothing_of_the_sort (x) VALUES (1)"),
      ]),
    ).rejects.toThrow()
    const { results } = await db.prepare("SELECT COUNT(*) AS n FROM events").all<{ n: number }>()
    expect(results[0]?.n).toBe(0)
    await db.close()
  })
})
