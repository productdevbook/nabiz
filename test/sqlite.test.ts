import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

import type { Monitor } from "../src/lib/probe.ts"
import { WINDOW } from "../src/lib/render.ts"
import { openSqlite } from "../src/lib/sqlite.ts"
import {
  addNotice,
  forPage,
  monitors,
  notices,
  prune,
  record,
  recentEvents,
  resolveNotice,
} from "../src/lib/store.ts"

const schema = readFileSync(new URL("../schema.sql", import.meta.url), "utf8")

async function fresh() {
  const db = openSqlite(":memory:")
  await db.exec(schema)
  return db
}

const seed = (slug: string, threshold = 2) =>
  `INSERT INTO monitors (slug, name, url, fail_threshold) VALUES ('${slug}', '${slug}', 'https://${slug}.example.com/', ${threshold})`

const result = (m: Monitor, ok: boolean) => ({
  monitor: m,
  ok,
  status: ok ? 200 : null,
  ms: 12,
  reason: ok ? null : ("unreachable" as const),
})

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

  test("a group's members cannot push every named service off the page", async () => {
    const db = await fresh()
    await db.exec(seed("api"))
    await db.exec(seed("shared"))
    await db.exec(`UPDATE monitors SET grouped = 1 WHERE slug = 'shared'`)
    const [api, shared] = await monitors(db)

    // The API's one outage is older than four hundred events a large group
    // wrote in a single round; one window for both loses it entirely.
    const many = Array.from(
      { length: 400 },
      (_, i) => `(${(shared as Monitor).id}, ${2000 + i}, ${i % 2}, 1)`,
    ).join(", ")
    await db.exec(
      `INSERT INTO events (monitor_id, at, ok, grouped) VALUES (${(api as Monitor).id}, 1000, 0, 0), ${many}`,
    )

    const recent = await recentEvents(db, 400)
    expect(recent.some((e) => e.monitor_id === (api as Monitor).id)).toBe(true)
    // Each kind gets the width, so the read is up to twice it.
    expect(recent.length).toBe(401)
    await db.close()
  })

  test("a grouped value that is not one is still grouped, and still read", async () => {
    const db = await fresh()
    await db.exec(seed("shared"))
    const [shared] = await monitors(db)
    // Monitors are hand-written rows: nothing stops a 2, and shape.ts
    // reads any non-zero as grouped. A window that asks for exactly 1
    // would drop this monitor's history on the floor.
    await db.exec(`UPDATE monitors SET grouped = 2 WHERE slug = 'shared'`)
    await record(db, [
      { ...result(shared as Monitor, false), monitor: { ...(shared as Monitor), grouped: 2 } },
    ])
    await record(db, [
      { ...result(shared as Monitor, false), monitor: { ...(shared as Monitor), grouped: 2 } },
    ])

    const recent = await recentEvents(db, 10)
    expect(recent.length).toBe(1)
    expect(recent[0]?.monitor_id).toBe((shared as Monitor).id)
    await db.close()
  })

  test("moving a service into a group moves its history with it", async () => {
    const db = await fresh()
    await db.exec(seed("api"))
    await db.exec(seed("shared"))
    const watched = await monitors(db)
    const [api, shared] = watched
    // Both were named when their events were written.
    const now = Date.now()
    await db.exec(
      `INSERT INTO events (monitor_id, at, ok, grouped) VALUES
       (${(api as Monitor).id}, ${now - 2000}, 0, 0), (${(shared as Monitor).id}, ${now - 1000}, 0, 0)`,
    )
    // Then an operator edits the row — the one column this code never
    // writes — and the copy on every event of that monitor is now a lie.
    await db.exec(`UPDATE monitors SET grouped = 1 WHERE slug = 'shared'`)

    await prune(db, await monitors(db))
    const kinds = await db
      .prepare("SELECT monitor_id, grouped FROM events ORDER BY monitor_id")
      .all<{ monitor_id: number; grouped: number }>()
    expect(kinds.results.map((r) => r.grouped)).toEqual([0, 1])
    await db.close()
  })

  test("and back again, by the same rule the page labels rows with", async () => {
    const db = await fresh()
    await db.exec(seed("shared"))
    const [shared] = await monitors(db)
    await db.exec(`UPDATE monitors SET grouped = 1 WHERE slug = 'shared'`)
    await db.exec(
      `INSERT INTO events (monitor_id, at, ok, grouped) VALUES (${(shared as Monitor).id}, ${Date.now()}, 0, 1)`,
    )
    await db.exec(`UPDATE monitors SET grouped = 0 WHERE slug = 'shared'`)

    await prune(db, await monitors(db))
    const kinds = await db.prepare("SELECT grouped FROM events").all<{ grouped: number }>()
    expect(kinds.results.map((r) => r.grouped)).toEqual([0])
    await db.close()
  })

  test("a disabled monitor's events do not push the watched ones off the page", async () => {
    const db = await fresh()
    await db.exec(seed("api"))
    await db.exec(seed("flapper"))
    const [api, flapper] = await monitors(db)

    // The flapping one wrote an event a minute; the API's outage is older
    // than all of them, and taking the limit first would lose it.
    const flaps = Array.from(
      { length: 12 },
      (_, i) => `(${(flapper as Monitor).id}, ${2000 + i}, ${i % 2})`,
    ).join(", ")
    await db.exec(
      `INSERT INTO events (monitor_id, at, ok) VALUES (${(api as Monitor).id}, 1000, 0), ${flaps}`,
    )
    await db.exec(`UPDATE monitors SET enabled = 0 WHERE slug = 'flapper'`)

    const recent = await recentEvents(db, 10)
    expect(recent.length).toBe(1)
    expect(recent[0]?.monitor_id).toBe((api as Monitor).id)
    await db.close()
  })

  test("a deleted monitor's history is not handed to the next one added", async () => {
    const db = await fresh()
    await db.exec(seed("gone"))
    const [gone] = await monitors(db)
    await record(db, [result(gone as Monitor, false)])
    await db.exec(`DELETE FROM monitors WHERE slug = 'gone'`)
    await prune(db)

    // SQLite hands the freed rowid to the next insert; without the sweep
    // this monitor would open with a stranger's failed day behind it.
    await db.exec(seed("new"))
    const [fresher] = await monitors(db)
    expect((fresher as Monitor).id).toBe((gone as Monitor).id)
    const data = await forPage(db, 90)
    expect(data.days.get((fresher as Monitor).id) ?? []).toEqual([])
    expect(data.states.get((fresher as Monitor).id)).toBeUndefined()
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

describe("the page's data is held for a moment, and dropped by a write", () => {
  test("a row written behind the page's back is not seen until something writes through the store", async () => {
    const db = await fresh()
    await db.exec(seed("api"))
    expect((await forPage(db, 90)).monitors.length).toBe(1)

    // Straight into the file, past everything that would drop the memo.
    await db.exec(seed("second"))
    expect((await forPage(db, 90)).monitors.length).toBe(1)

    // A write through the store is what says the page has changed.
    await addNotice(db, "info", "something happened", null)
    expect((await forPage(db, 90)).monitors.length).toBe(2)
    await db.close()
  })

  test("two databases do not read each other's answer", async () => {
    const one = await fresh()
    const two = await fresh()
    await one.exec(seed("api"))
    expect((await forPage(one, 90)).monitors.length).toBe(1)
    expect((await forPage(two, 90)).monitors.length).toBe(0)
    await one.close()
    await two.close()
  })

  test("a probe round makes its own result visible", async () => {
    const db = await fresh()
    await db.exec(seed("api"))
    const [api] = await monitors(db)
    await forPage(db, 90)
    await record(db, [result(api as Monitor, true)])
    expect((await forPage(db, 90)).states.get(1)?.ok).toBe(true)
    await db.close()
  })
})

describe("what a window includes", () => {
  test("the days summed are the days drawn, and there are ninety of them", async () => {
    const db = await fresh()
    await db.exec(seed("api"))
    const now = Date.now()
    const day = (back: number) => new Date(now - back * 86400000).toISOString().slice(0, 10)
    // A hundred days of history, all perfect except the day exactly ninety
    // back — which the strip does not draw, so the figure must not see it.
    const rows: string[] = []
    for (let i = 0; i < 100; i += 1) rows.push(`(1, '${day(i)}', 100, ${i === 90 ? 0 : 100}, 2000)`)
    await db.exec(`INSERT INTO days (monitor_id, day, total, ok, ms_sum) VALUES ${rows.join(",")}`)

    const data = await forPage(db, WINDOW)
    const days = data.days.get(1) ?? []
    expect(days.length).toBe(WINDOW)
    expect(days.filter((d) => d.ok < d.total)).toEqual([])
    await db.close()
  })

  test("a clock that ran ahead cannot be summed, charted or called fresh", async () => {
    const db = await fresh()
    await db.exec(seed("api"))
    const now = Date.now()
    const ahead = now + 3 * 86400000
    await db.exec(
      `INSERT INTO days (monitor_id, day, total, ok, ms_sum) VALUES
       (1, '${new Date(now).toISOString().slice(0, 10)}', 100, 100, 2000),
       (1, '${new Date(ahead).toISOString().slice(0, 10)}', 5, 0, 100)`,
    )
    await db.exec(
      `INSERT INTO checks (monitor_id, at, ok, status, ms) VALUES
       (1, ${now - 300000}, 1, 200, 90), (1, ${ahead}, 1, 200, 4000)`,
    )

    const data = await forPage(db, WINDOW)
    expect((data.days.get(1) ?? []).some((d) => d.ok < d.total)).toBe(false)
    expect(data.latency.get(1)).toBe(90)
    expect(data.wrote).toBe(now - 300000)
    await db.close()
  })
})
