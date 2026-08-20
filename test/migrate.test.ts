import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

import { migrate } from "../src/lib/migrate.ts"
import { openSqlite } from "../src/lib/sqlite.ts"
import { forPage, monitors } from "../src/lib/store.ts"

const schema = readFileSync(new URL("../schema.sql", import.meta.url), "utf8")

/** The schema as v1.0.0 shipped it: before notices, before the language on
 *  them, before the last status. */
const OLD = `
CREATE TABLE monitors (
  id INTEGER PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, url TEXT NOT NULL,
  method TEXT NOT NULL DEFAULT 'GET', expect_status INTEGER NOT NULL DEFAULT 200,
  timeout_ms INTEGER NOT NULL DEFAULT 10000, group_name TEXT,
  grouped INTEGER NOT NULL DEFAULT 0, enabled INTEGER NOT NULL DEFAULT 1,
  position INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE checks (monitor_id INTEGER NOT NULL, at INTEGER NOT NULL, ok INTEGER NOT NULL, status INTEGER, ms INTEGER);
CREATE TABLE days (monitor_id INTEGER NOT NULL, day TEXT NOT NULL, total INTEGER NOT NULL DEFAULT 0,
  ok INTEGER NOT NULL DEFAULT 0, ms_sum INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (monitor_id, day));
CREATE TABLE state (monitor_id INTEGER PRIMARY KEY, ok INTEGER NOT NULL, since INTEGER NOT NULL);
CREATE TABLE events (monitor_id INTEGER NOT NULL, at INTEGER NOT NULL, ok INTEGER NOT NULL);
`

async function old() {
  const db = openSqlite(":memory:")
  await db.exec(OLD)
  await db
    .prepare("INSERT INTO monitors (slug, name, url) VALUES (?, ?, ?)")
    .bind("api", "API", "https://api.example.com/")
    .run()
  await db.prepare("INSERT INTO state (monitor_id, ok, since) VALUES (1, 1, 5)").run()
  await db
    .prepare("INSERT INTO days (monitor_id, day, total, ok) VALUES (1, '2026-08-01', 9, 9)")
    .run()
  return db
}

describe("a database that started on an older version", () => {
  test("gains the columns the schema file cannot add, and keeps its history", async () => {
    const db = await old()
    // What a start does, in the order it does it: the columns the schema
    // file cannot reach, then the file — which carries an index over one
    // of those columns and cannot run before it is there.
    const added = await migrate(db)
    await db.exec(schema)

    expect(added).toEqual([
      "monitors.expect_body",
      "monitors.fail_threshold",
      "state.fails",
      "state.last_status",
      "state.last_reason",
      "events.grouped",
    ])
    const [api] = await monitors(db)
    expect(api?.name).toBe("API")
    expect(api?.fail_threshold).toBe(2)
    const data = await forPage(db, 90)
    expect(data.days.get(1)?.[0]?.ok).toBe(9)
    expect(data.states.get(1)?.ok).toBe(true)
    await db.close()
  })

  test("running it again adds nothing", async () => {
    const db = await old()
    await migrate(db)
    await db.exec(schema)
    expect(await migrate(db)).toEqual([])
    await db.close()
  })

  test("a database made this morning needs nothing", async () => {
    const db = openSqlite(":memory:")
    await db.exec(schema)
    expect(await migrate(db)).toEqual([])
    await db.close()
  })
})
