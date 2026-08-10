import { describe, expect, test } from "bun:test"

import type { Monitor } from "../src/probe"
import { eventsView, overall, rows, uptimeOf } from "../src/shape"
import type { PageData } from "../src/store"

let nextId = 0
function monitor(over: Partial<Monitor> = {}): Monitor {
  nextId += 1
  return {
    id: nextId,
    slug: `m${nextId}`,
    name: `M${nextId}`,
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

function data(monitors: Monitor[], states: [number, boolean][]): PageData {
  return {
    monitors,
    states: new Map(states.map(([id, ok]) => [id, { ok, since: 0 }])),
    days: new Map(),
    latency: new Map(),
    spark: new Map(),
  }
}

describe("grouped monitors are counted, never listed", () => {
  test("a group collapses to a tally under its group name", () => {
    const a = monitor({ grouped: 1, group_name: "Hosted", name: "secret-a" })
    const b = monitor({ grouped: 1, group_name: "Hosted", name: "secret-b" })
    const list = rows(
      data(
        [a, b],
        [
          [a.id, true],
          [b.id, false],
        ],
      ),
    )

    expect(list).toHaveLength(1)
    expect(list[0]?.name).toBe("Hosted")
    expect(list[0]?.tally).toBe("1/2")
    expect(JSON.stringify(list)).not.toContain("secret")
  })

  test("events from grouped members speak under the group's name", () => {
    const a = monitor({ grouped: 1, group_name: "Hosted", name: "secret-a" })
    const view = eventsView([a], [{ monitor_id: a.id, at: 1, ok: 0 }])
    expect(view[0]?.label).toBe("Hosted")
  })
})

describe("the banner tells the honest worst", () => {
  test("everything up reads up", () => {
    const m = monitor()
    expect(overall(rows(data([m], [[m.id, true]])))).toBe("up")
  })
  test("one of two down reads degraded", () => {
    const a = monitor()
    const b = monitor()
    expect(
      overall(
        rows(
          data(
            [a, b],
            [
              [a.id, true],
              [b.id, false],
            ],
          ),
        ),
      ),
    ).toBe("degraded")
  })
  test("everything down reads down", () => {
    const m = monitor()
    expect(overall(rows(data([m], [[m.id, false]])))).toBe("down")
  })
  test("nothing known yet reads up rather than crying wolf", () => {
    const m = monitor()
    expect(overall(rows(data([m], [])))).toBe("up")
  })
})

describe("uptime arithmetic", () => {
  test("no data is null, not a triumphant 100", () => {
    expect(uptimeOf([])).toBeNull()
  })
  test("counts across days", () => {
    expect(
      uptimeOf([
        { monitor_id: 1, day: "2026-01-01", total: 100, ok: 99, ms_sum: 0 },
        { monitor_id: 1, day: "2026-01-02", total: 100, ok: 100, ms_sum: 0 },
      ]),
    ).toBeCloseTo(99.5)
  })
})
