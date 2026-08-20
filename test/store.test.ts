import { describe, expect, test } from "bun:test"

import type { Monitor, ProbeResult } from "../src/lib/probe.ts"
import { record } from "../src/lib/store.ts"
import { fakeDb } from "./fake-d1.ts"

function monitor(over: Partial<Monitor> = {}): Monitor {
  return {
    id: 1,
    slug: "m",
    name: "M",
    url: "https://example.com/",
    method: "GET",
    expect_status: 200,
    timeout_ms: 10000,
    expect_body: null,
    fail_threshold: 2,
    group_name: null,
    grouped: 0,
    enabled: 1,
    position: 0,
    ...over,
  }
}

function result(ok: boolean, m = monitor()): ProbeResult {
  return { monitor: m, ok, status: ok ? 200 : null, ms: 5 }
}

function withState(rows: { monitor_id: number; ok: number; since: number; fails: number }[]) {
  return fakeDb((sql) => (sql.includes("FROM state") ? rows : []))
}

const stateWrite = (writes: { sql: string; args: unknown[] }[]) =>
  writes.findLast((w) => w.sql.includes("INTO state"))
const eventWrites = (writes: { sql: string; args: unknown[] }[]) =>
  writes.filter((w) => w.sql.includes("INTO events"))

describe("the monitor is not called down on one bad minute", () => {
  test("first failure below the threshold changes nothing outward", async () => {
    const { db, writes } = withState([{ monitor_id: 1, ok: 1, since: 0, fails: 0 }])
    const changes = await record(db, [result(false)])

    expect(changes).toEqual([])
    expect(eventWrites(writes)).toEqual([])
    // …but the strike is counted, and the monitor still reads as up.
    expect(stateWrite(writes)?.args).toEqual([1, 1, 0, 1, null])
  })

  test("the threshold-th failure in a row is the outage", async () => {
    const { db, writes } = withState([{ monitor_id: 1, ok: 1, since: 0, fails: 1 }])
    const changes = await record(db, [result(false)])

    expect(changes).toHaveLength(1)
    expect(changes[0]?.ok).toBe(false)
    expect(eventWrites(writes)).toHaveLength(1)
  })

  test("a success wipes the strikes", async () => {
    const { db, writes } = withState([{ monitor_id: 1, ok: 1, since: 7, fails: 1 }])
    const changes = await record(db, [result(true)])

    expect(changes).toEqual([])
    const w = stateWrite(writes)
    expect(w?.args?.[3]).toBe(0)
    expect(w?.args?.[2]).toBe(7) // an unbroken up-state keeps its birthday
  })

  test("recovery is immediate, whatever the threshold", async () => {
    const { db, writes } = withState([{ monitor_id: 1, ok: 0, since: 0, fails: 5 }])
    const changes = await record(db, [result(true)])

    expect(changes).toHaveLength(1)
    expect(changes[0]?.ok).toBe(true)
    expect(eventWrites(writes)).toHaveLength(1)
  })

  test("a threshold of one keeps the old reflexes", async () => {
    const { db } = withState([{ monitor_id: 1, ok: 1, since: 0, fails: 0 }])
    const changes = await record(db, [result(false, monitor({ fail_threshold: 1 }))])
    expect(changes).toHaveLength(1)
  })

  test("the very first sighting is a state, not an event", async () => {
    const { db, writes } = withState([])
    const changes = await record(db, [result(true)])

    expect(changes).toEqual([])
    expect(eventWrites(writes)).toEqual([])
    expect(stateWrite(writes)?.args).toBeDefined()
  })

  test("while down, further failures stay quiet", async () => {
    const { db, writes } = withState([{ monitor_id: 1, ok: 0, since: 3, fails: 2 }])
    const changes = await record(db, [result(false)])

    expect(changes).toEqual([])
    expect(eventWrites(writes)).toEqual([])
    const w = stateWrite(writes)
    expect(w?.args).toEqual([1, 0, 3, 3, null])
  })
})

describe("a monitor that is down the first time it is seen", () => {
  // Up on the first sighting is not news. Down is: it is the URL somebody
  // just added, not answering, and silence leaves them wondering whether
  // the page works at all.
  test("says so, once", async () => {
    const { db, writes } = withState([])
    const changes = await record(db, [result(false)])

    expect(changes).toHaveLength(1)
    expect(changes[0]?.ok).toBe(false)
    expect(changes[0]?.heldFor).toBeNull()
    expect(eventWrites(writes)).toHaveLength(1)
  })

  test("and one that is up says nothing", async () => {
    const { db, writes } = withState([])
    expect(await record(db, [result(true)])).toEqual([])
    expect(eventWrites(writes)).toEqual([])
  })
})
