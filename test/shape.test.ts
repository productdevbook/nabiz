import { describe, expect, test } from "bun:test"

import type { Monitor } from "../src/lib/probe"
import type { Row } from "../src/lib/shape"
import { eventsView, overall, rows, uptimeOf } from "../src/lib/shape"
import type { PageData } from "../src/lib/store"

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
  test("a group speaks under its own name and publishes no count", () => {
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
    // The row says how the group is, never how many it speaks for.
    expect(JSON.stringify(list[0])).not.toContain("1/2")
    expect(JSON.stringify(list)).not.toContain("secret")
  })

  test("events from grouped members speak under the group's name", () => {
    const a = monitor({ grouped: 1, group_name: "Hosted", name: "secret-a" })
    const view = eventsView([a], [{ monitor_id: a.id, at: 1, ok: 0 }])
    expect(view[0]?.label).toBe("Hosted")
  })
})

describe("one customer's site is not every customer's site", () => {
  test("one member's bad day does not become the group's history", () => {
    const day = (id: number, ok: number, total: number) => ({
      monitor_id: id,
      day: "2026-08-12",
      total,
      ok,
      ms_sum: 0,
    })
    const members: Monitor[] = [1, 2, 3, 4, 5].map(
      (id) =>
        ({
          id,
          slug: `s${id}`,
          name: `site ${id}`,
          url: "https://example.test/",
          method: "GET",
          expect_status: 200,
          timeout_ms: 1000,
          expect_body: null,
          fail_threshold: 2,
          group_name: "Hosted sites",
          grouped: 1,
          enabled: 1,
          position: id,
        }) as unknown as Monitor,
    )
    const days = new Map([
      // Four perfect days and one site down half the day.
      [1, [day(1, 1440, 1440)]],
      [2, [day(2, 1440, 1440)]],
      [3, [day(3, 1440, 1440)]],
      [4, [day(4, 1440, 1440)]],
      [5, [day(5, 720, 1440)]],
    ])
    const list = rows({
      monitors: members,
      states: new Map(members.map((m) => [m.id, { ok: m.id !== 5, since: 0 }])),
      days,
      latency: new Map(),
      spark: new Map(),
    })
    // The median member had a perfect day, so the group's day is perfect.
    expect(uptimeOf(list[0]?.days ?? [])).toBe(100)
  })

  test("half or more unreachable is the machine's problem, fewer is not", () => {
    const half = (up: number, total: number): Monitor[] =>
      Array.from({ length: total }, (_, i) => ({
        id: i + 1,
        slug: `s${i}`,
        name: `site ${i}`,
        url: "https://example.test/",
        method: "GET",
        expect_status: 200,
        timeout_ms: 1000,
        expect_body: null,
        fail_threshold: 2,
        group_name: "Hosted sites",
        grouped: 1,
        enabled: 1,
        position: i,
      })).map((m, i) => ({ ...m, ok: i < up }) as unknown as Monitor)

    const shape = (up: number, total: number) => {
      const monitors = half(up, total)
      const states = new Map(monitors.map((m, i) => [m.id, { ok: i < up, since: 0 }]))
      return rows({
        monitors,
        states,
        days: new Map(),
        latency: new Map(),
        spark: new Map(),
      })[0]
    }

    expect(shape(5, 5)?.ok).toBe(true)
    // One of five: trouble, and the page still says something is serving.
    expect(shape(4, 5)?.partial).toBe(true)
    // Three of five: the machine's problem, and the row says down.
    expect(shape(2, 5)?.partial).toBe(false)
    expect(shape(2, 5)?.ok).toBe(false)
  })

  test("the banner stays calm while most of a group is serving", () => {
    const partly: Row[] = [
      { name: "API", ok: true, partial: false, days: [], latency: 10, spark: null },
      {
        name: "Hosted sites",
        ok: false,
        partial: true,
        days: [],
        latency: null,
        spark: null,
      },
    ]
    // One customer's own certificate being wrong is not everyone's news.
    expect(overall(partly)).toBe("up")
  })

  test("a group where nothing answers is an outage", () => {
    const all: Row[] = [
      {
        name: "Hosted sites",
        ok: false,
        partial: false,
        days: [],
        latency: null,
        spark: null,
      },
    ]
    expect(overall(all)).toBe("down")
  })

  test("a partly-up group never speaks for the whole page", () => {
    const only: Row[] = [
      {
        name: "Hosted sites",
        ok: false,
        partial: true,
        days: [],
        latency: null,
        spark: null,
      },
    ]
    expect(overall(only)).toBe("up")
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
