import { describe, expect, test } from "bun:test"

import type { Monitor } from "../src/lib/probe.ts"
import type { Row } from "../src/lib/shape.ts"
import { eventsView, overall, rows, UNNAMED_GROUP, uptimeOf } from "../src/lib/shape.ts"
import type { DayRow, PageData } from "../src/lib/store.ts"

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

const downNow = (list: Monitor[]) => new Map(list.map((m) => [m.id, { ok: false, code: null }]))

function data(monitors: Monitor[], states: [number, boolean][]): PageData {
  return {
    monitors,
    states: new Map(states.map(([id, ok]) => [id, { ok, code: null }])),
    days: new Map(),
    latency: new Map(),
    spark: new Map(),
    wrote: null,
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
    const view = eventsView([a], [{ monitor_id: a.id, at: 1, ok: 0 }], downNow([a]))
    expect(view[0]?.label).toBe("Hosted")
  })
})

const hosted = (total: number): Monitor[] =>
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
  }))

const day = (id: number, ok: number, total: number) => ({
  monitor_id: id,
  day: "2026-08-12",
  total,
  ok,
  ms_sum: 0,
})

describe("one customer's site is not every customer's site", () => {
  test("one member's bad day does not become the group's history", () => {
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
      states: new Map(members.map((m) => [m.id, { ok: m.id !== 5, code: null }])),
      days,
      latency: new Map(),
      spark: new Map(),
      wrote: null,
    })
    // The median member had a perfect day, so the group's day is perfect.
    expect(uptimeOf(list[0]?.days ?? [])).toBe(100)
  })

  test("half or more unreachable is the machine's problem, fewer is not", () => {
    const shape = (up: number, total: number) => {
      const monitors = hosted(total)
      const states = new Map(monitors.map((m, i) => [m.id, { ok: i < up, code: null }]))
      return rows({
        monitors,
        states,
        days: new Map(),
        latency: new Map(),
        spark: new Map(),
        wrote: null,
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
      { name: "API", ok: true, code: null, partial: false, days: [], latency: 10, spark: null },
      {
        name: "Hosted sites",
        ok: false,
        code: null,
        partial: true,
        days: [],
        latency: null,
        spark: null,
      },
    ]
    // Said plainly, in its own words: not an outage, not silence either.
    expect(overall(partly)).toBe("sites")
  })

  test("a group where nothing answers is an outage", () => {
    const all: Row[] = [
      {
        name: "Hosted sites",
        ok: false,
        code: null,
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
        code: null,
        partial: true,
        days: [],
        latency: null,
        spark: null,
      },
    ]
    expect(overall(only)).toBe("sites")
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

const withDays = (monitors: Monitor[], days: [number, DayRow[]][]): PageData => ({
  ...data(monitors, []),
  days: new Map(days),
})

const dayRow = (on: string, ok: number, total: number, ms_sum = 0): DayRow => ({
  monitor_id: 0,
  day: on,
  total,
  ok,
  ms_sum,
})

describe("a row that says it is grouped is never published by name", () => {
  test("a group nobody named still does not name its members", () => {
    const a = monitor({ grouped: 1, group_name: null, name: "secret-a" })
    const b = monitor({ grouped: 1, group_name: "  ", name: "secret-b" })
    const list = rows(data([a, b], [[a.id, false]]))
    expect(list.map((r) => r.name)).toEqual([UNNAMED_GROUP])
    expect(JSON.stringify(list)).not.toContain("secret")
  })

  test("neither do its events", () => {
    const a = monitor({ grouped: 1, group_name: null, name: "secret-a" })
    const view = eventsView([a], [{ monitor_id: a.id, at: 5, ok: 0 }], downNow([a]))
    expect(view.map((e) => e.label)).toEqual([UNNAMED_GROUP])
  })

  test("one host going down is one line, not one line per customer", () => {
    // Five members, five events; the page says the group went down once.
    const members = [1, 2, 3, 4, 5].map(() =>
      monitor({ grouped: 1, group_name: "Hosted sites", name: "secret" }),
    )
    const events = members.map((m, i) => ({ monitor_id: m.id, at: 1000 + i, ok: 0 }))
    const view = eventsView(members, events.toReversed(), downNow(members))
    expect(view).toEqual([{ label: "Hosted sites", at: 1002, ok: false }])
  })

  test("members falling in different rounds is still one line", () => {
    // The old collapse only joined members that fell in the same round, so
    // two customers on two afternoons printed two lines — which is two
    // customers, counted off the page.
    const [a, b] = [1, 2].map(() => monitor({ grouped: 1, group_name: "Hosted sites" }))
    const view = eventsView(
      [a as Monitor, b as Monitor],
      [
        { monitor_id: (b as Monitor).id, at: 9_030, ok: 0 },
        { monitor_id: (a as Monitor).id, at: 9_020, ok: 0 },
      ],
      downNow([a as Monitor, b as Monitor]),
    )
    expect(view).toEqual([{ label: "Hosted sites", at: 9_020, ok: false }])
  })

  test("one member of five is the group's weather, not its news", () => {
    // The row says "partly up"; a line underneath saying "down" would
    // contradict the row above it.
    const members = [1, 2, 3, 4, 5].map(() => monitor({ grouped: 1, group_name: "Hosted sites" }))
    const states = new Map(
      members.map(
        (m, i) =>
          [m.id, { ok: i > 0, since: 0 }] as [number, { ok: boolean; since: number; code: null }],
      ),
    )
    const view = eventsView(members, [{ monitor_id: members[0]?.id ?? 0, at: 5, ok: 0 }], states)
    expect(view).toEqual([])
  })

  test("a group that comes all the way back says so where it crossed", () => {
    const members = [1, 2, 3].map(() => monitor({ grouped: 1, group_name: "Hosted sites" }))
    const up = new Map(members.map((m) => [m.id, { ok: true, code: null }]))
    // Newest first: three members returning, one at a time. The group
    // stopped being down when the second of them came back, not the third.
    const view = eventsView(
      members,
      [
        { monitor_id: members[2]?.id ?? 0, at: 40, ok: 1 },
        { monitor_id: members[1]?.id ?? 0, at: 30, ok: 1 },
        { monitor_id: members[0]?.id ?? 0, at: 20, ok: 1 },
      ],
      up,
    )
    expect(view).toEqual([{ label: "Hosted sites", at: 30, ok: true }])
  })

  // A recovery published without the outage it ends is an item a
  // subscriber cannot make sense of — and the row above it never said the
  // group was down.
  test("a member's blip announces nothing at all", () => {
    const members = [1, 2, 3, 4, 5].map(() => monitor({ grouped: 1, group_name: "Hosted sites" }))
    const up = new Map(members.map((m) => [m.id, { ok: true, code: null }]))
    const one = members[1]?.id ?? 0
    const view = eventsView(
      members,
      [
        { monitor_id: one, at: 200, ok: 1 },
        { monitor_id: one, at: 100, ok: 0 },
      ],
      up,
    )
    expect(view).toEqual([])
  })

  test("an outage and its end are one line each, or neither", () => {
    const [a, b] = [1, 2].map(() => monitor({ grouped: 1, group_name: "Hosted sites" }))
    const up = new Map([a as Monitor, b as Monitor].map((m) => [m.id, { ok: true, code: null }]))
    const view = eventsView(
      [a as Monitor, b as Monitor],
      [
        { monitor_id: (b as Monitor).id, at: 400, ok: 1 },
        { monitor_id: (a as Monitor).id, at: 300, ok: 1 },
        { monitor_id: (b as Monitor).id, at: 200, ok: 0 },
        { monitor_id: (a as Monitor).id, at: 100, ok: 0 },
      ],
      up,
    )
    expect(view.map((e) => e.ok)).toEqual([true, false])
  })

  test("a monitor speaking for itself is untouched", () => {
    const api = monitor({ name: "API" })
    const view = eventsView(
      [api],
      [
        { monitor_id: api.id, at: 20, ok: 1 },
        { monitor_id: api.id, at: 10, ok: 0 },
      ],
      new Map([[api.id, { ok: true, code: null }]]),
    )
    expect(view.map((e) => e.ok)).toEqual([true, false])
  })

  test("the limit counts lines the page shows, not rows the store read", () => {
    const api = monitor({ name: "API" })
    const events = [50, 40, 30, 20, 10].map((at, i) => ({ monitor_id: api.id, at, ok: i % 2 }))
    const view = eventsView([api], events, new Map([[api.id, { ok: false, code: null }]]), 2)
    expect(view.length).toBe(2)
  })
})

describe("a group's ninety days are the group's", () => {
  test("a day most of the group did not exist for is not the group's day", () => {
    // One customer hosted for a year, four onboarded last month: the old
    // customer's bad day is not four other people's history.
    const old = monitor({ grouped: 1, group_name: "Hosted sites" })
    const rest = [1, 2, 3, 4].map(() => monitor({ grouped: 1, group_name: "Hosted sites" }))
    const list = rows(
      withDays(
        [old, ...rest],
        [
          [old.id, [dayRow("2026-06-20", 0, 1000), dayRow("2026-08-18", 1000, 1000)]],
          ...rest.map((m): [number, DayRow[]] => [m.id, [dayRow("2026-08-18", 1000, 1000)]]),
        ],
      ),
    )
    expect(list[0]?.days.map((d) => d.day)).toEqual(["2026-08-18"])
    expect(uptimeOf(list[0]?.days ?? [])).toBe(100)
  })

  test("the day it publishes is a real member's, counts and timings and all", () => {
    const members = [1, 2, 3].map(() => monitor({ grouped: 1, group_name: "Hosted sites" }))
    const list = rows(
      withDays(
        [...members],
        [
          [members[0]?.id ?? 0, [dayRow("2026-08-18", 1440, 1440, 172_800)]],
          [members[1]?.id ?? 0, [dayRow("2026-08-18", 1430, 1440, 180_000)]],
          [members[2]?.id ?? 0, [dayRow("2026-08-18", 1440, 1440, 187_200)]],
        ],
      ),
    )
    const published = list[0]?.days[0]
    // Not a thousand imagined checks with no time attached: history.json
    // publishes these as if a probe had produced them.
    expect(published?.total).toBe(1440)
    // The median member's own timings, not a number that merely exists.
    expect(published?.ms_sum).toBe(172_800)
  })
})

describe("position places a group as well as a monitor", () => {
  test("a group whose members come first is not printed last", () => {
    const members = [1, 2].map(() => monitor({ grouped: 1, group_name: "Hosted sites" }))
    const api = monitor({ name: "API" })
    // rows() takes the order the store gives it, which is by position.
    const list = rows(data([...members, api], []))
    expect(list.map((r) => r.name)).toEqual(["Hosted sites", "API"])
  })
})
