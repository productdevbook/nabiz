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
  return {
    monitor: m,
    ok,
    status: ok ? 200 : null,
    ms: 5,
    reason: ok ? null : ("unreachable" as const),
  }
}

function withState(
  rows: { monitor_id: number; ok: number; since: number; fails: number; fail_at?: number }[],
) {
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
    // …but the strike is counted, and the monitor still reads as up. The
    // last argument is when this run of failures began: the recovery
    // message counts the outage from there, not from the threshold.
    const args = stateWrite(writes)?.args as unknown[]
    expect(args.slice(0, 6)).toEqual([1, 1, 0, 1, null, "unreachable"])
    expect(typeof args[6]).toBe("number")
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
    // A row already down keeps the moment it started failing; a row with
    // none from before this release falls back to when it was called down.
    expect((w as { args: unknown[] }).args.slice(0, 6)).toEqual([1, 0, 3, 3, null, "unreachable"])
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

describe("how long an outage was", () => {
  test("the recovery counts from the first failed probe, not the threshold", async () => {
    const minute = 60_000
    const now = Date.now()
    // Up since an hour ago, failing for two rounds, called down on the
    // second. It recovers now: the outage is two rounds long, not one.
    const { db } = withState([
      { monitor_id: 1, ok: 0, since: now - 2 * minute, fails: 2, fail_at: now - 2 * minute },
    ])
    const [change] = await record(db, [result(true)])
    expect(change?.ok).toBe(true)
    expect(Math.round((change?.heldFor ?? 0) / 60)).toBe(2)
  })

  test("a row written before this release still answers, from what it has", async () => {
    const minute = 60_000
    const now = Date.now()
    // Five minutes down at a minute a round is five failures on the row;
    // there is no fail_at, so `since` is what it has.
    const { db } = withState([{ monitor_id: 1, ok: 0, since: now - 5 * minute, fails: 5 }])
    const [change] = await record(db, [result(true)])
    expect(Math.round((change?.heldFor ?? 0) / 60)).toBe(5)
  })

  test("an outage cannot be longer than the failures that reach back to it", async () => {
    const minute = 60_000
    const now = Date.now()
    // A process that failed once, stopped for three days, came back, failed
    // again and recovered a minute later. Two failures cannot span three
    // days at a minute a round, whatever the row remembers.
    const { db } = withState([
      {
        monitor_id: 1,
        ok: 0,
        since: now - 3 * 86_400_000,
        fails: 2,
        fail_at: now - 3 * 86_400_000,
      },
    ])
    const [change] = await record(db, [result(true)], minute)
    expect(Math.round((change?.heldFor ?? 0) / 60)).toBe(3)
  })

  test("going down is timed from the probe that failed, not the one that admitted it", async () => {
    const minute = 60_000
    const now = Date.now()
    const { db } = withState([
      { monitor_id: 1, ok: 1, since: now - 10 * minute, fails: 1, fail_at: now - minute },
    ])
    const [change] = await record(db, [result(false)])
    expect(change?.ok).toBe(false)
    // Up for nine minutes, not ten: it stopped being up a minute ago.
    expect(Math.round((change?.heldFor ?? 0) / 60)).toBe(9)
  })
})
