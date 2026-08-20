import { describe, expect, test } from "bun:test"

import { feed, forgive, llms, postNotice, throttled } from "../src/lib/api.ts"
import type { Db } from "../src/lib/db.ts"
import type { Monitor } from "../src/lib/probe.ts"
import type { Notice, PageData } from "../src/lib/store.ts"

const from = (ip: string) =>
  new Request("https://status.example.com/api/notice", {
    method: "POST",
    headers: { "cf-connecting-ip": ip },
  })

describe("the brake on token guessing", () => {
  test("ten tries pass, the eleventh does not", () => {
    for (let i = 0; i < 10; i++) expect(throttled(from("192.0.2.1"))).toBe(false)
    expect(throttled(from("192.0.2.1"))).toBe(true)
  })

  test("another address is not punished for the first one's sins", () => {
    for (let i = 0; i < 11; i++) throttled(from("192.0.2.2"))
    expect(throttled(from("192.0.2.3"))).toBe(false)
  })

  test("the window closes and the counter forgets", () => {
    for (let i = 0; i < 11; i++) throttled(from("192.0.2.4"))
    expect(throttled(from("192.0.2.4"), Date.now() + 61_000)).toBe(false)
  })

  // A flood of addresses is remembered, but not forever: the map has a
  // ceiling, and reaching it forgets the entries nearest their expiry
  // rather than growing until the process dies.
  test("the map of addresses does not grow without end", () => {
    for (let i = 0; i < 11; i += 1) throttled(from("198.51.100.1"))
    expect(throttled(from("198.51.100.1"))).toBe(true)
    for (let i = 0; i < 11_000; i += 1) throttled(from(`203.0.113.${i}`))
    // Evicted along with the flood, which is the trade the ceiling makes.
    expect(throttled(from("198.51.100.1"))).toBe(false)
  })

  // The operator writing a run of updates during an incident is not a
  // brute force, and the tenth notice is not the one to refuse.
  test("a request that turned out to be authorized is not a guess", () => {
    for (let i = 0; i < 9; i++) throttled(from("192.0.2.5"))
    forgive(from("192.0.2.5"))
    for (let i = 0; i < 10; i++) expect(throttled(from("192.0.2.5"))).toBe(false)
  })
})

const nowhere = {
  prepare: () => {
    throw new Error("the body was refused before it reached the database")
  },
  batch: async () => [],
} as unknown as Db

const jsonPost = (raw: string) =>
  new Request("https://status.example.com/api/notice", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: raw,
  })

describe("a body that is not an object is a bad request", () => {
  test("null, a string and a list are all refused with 400", async () => {
    const answers = await Promise.all(
      ["null", '"a notice"', "[1, 2]", "{"].map((raw) => postNotice(jsonPost(raw), nowhere)),
    )
    expect(answers.map((r) => r.status)).toEqual([400, 400, 400, 400])
  })
})

const monitor = (over: Partial<Monitor> = {}): Monitor => ({
  id: 1,
  slug: "api",
  name: "API",
  url: "https://api.example.com/",
  method: "GET",
  expect_status: 200,
  timeout_ms: 1000,
  expect_body: null,
  fail_threshold: 2,
  group_name: null,
  grouped: 0,
  enabled: 1,
  position: 0,
  ...over,
})

const page = (monitors: Monitor[]): PageData => ({
  monitors,
  states: new Map(),
  days: new Map(),
  latency: new Map(),
  spark: new Map(),
  wrote: null,
})

const notice = (text: string): Notice => ({
  id: 1,
  at: 1_700_000_000_000,
  severity: "degraded",
  body_md: text,
  resolved_at: null,
  lang: null,
})

/** Every & in a well-formed document opens an entity, and XML carries no
 *  control character but tab, newline and carriage return. */
function illFormed(xml: string): string[] {
  const wrong: string[] = []
  for (const m of xml.matchAll(/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g))
    wrong.push(`bare & at ${m.index}`)
  for (const ch of xml) {
    const code = ch.codePointAt(0) as number
    if (code < 0x20 && code !== 9 && code !== 10 && code !== 13) wrong.push(`control U+${code}`)
    if (code >= 0xd800 && code <= 0xdfff) wrong.push(`lone surrogate`)
  }
  return wrong
}

describe("the feed stays readable whatever is written into it", () => {
  test("a title cut at a hundred characters is cut before it is escaped", async () => {
    // The ampersand sits where the cut lands, so escaping first would leave
    // half an entity behind — and half an entity costs the whole document.
    const body = "x".repeat(98) + "& more"
    const xml = await feed(
      "https://status.example.com",
      "t",
      page([]),
      [],
      [notice(body)],
      "en",
    ).text()
    expect(illFormed(xml)).toEqual([])
  })

  test("a control character in a notice does not cost the subscriber the feed", async () => {
    const xml = await feed(
      "https://status.example.com",
      "t",
      page([]),
      [],
      [notice("before\u0008after")],
      "en",
    ).text()
    expect(illFormed(xml)).toEqual([])
  })

  test("a control character in a monitor's name does not either", async () => {
    const monitors = [monitor({ name: "API\u000bEU" })]
    const events = [{ monitor_id: 1, at: 1_700_000_000_000, ok: 0 }]
    const xml = await feed(
      "https://status.example.com",
      "t\u0007",
      page(monitors),
      events,
      [],
      "en",
    ).text()
    expect(illFormed(xml)).toEqual([])
  })
})

describe("llms.txt is the shape the specification asks for", () => {
  test("a heading, a summary to read first, and lists of links", async () => {
    const text = await llms("https://status.example.com", "example").text()
    const lines = text.split("\n")

    expect(lines[0]).toBe("# example")
    // The summary a reader takes before anything else.
    expect(lines[2]?.startsWith("> ")).toBe(true)

    // Every list entry is a link, not a sentence about one.
    const items = lines.filter((l) => l.startsWith("- "))
    expect(items.length).toBeGreaterThan(5)
    expect(items.filter((l) => !/^- \[[^\]]+\]\(https:\/\/[^)]+\)/.test(l))).toEqual([])

    // Every section is an h2; the file has no deeper headings to skip.
    expect(lines.filter((l) => l.startsWith("#")).filter((l) => !/^(# |## )/.test(l))).toEqual([])
  })
})

describe("the page says when it last learned anything", () => {
  test("updated_at is the last write, not the render", async () => {
    const { statusJson } = await import("../src/lib/api.ts")
    const data = { ...page([]), wrote: 1_700_000_000_000 }
    const body = (await statusJson(data, []).json()) as { updated_at: string | null }
    expect(body.updated_at).toBe("2023-11-14T22:13:20.000Z")
  })

  test("a page that has never written says so rather than saying now", async () => {
    const { statusJson } = await import("../src/lib/api.ts")
    const body = (await statusJson(page([]), []).json()) as { updated_at: string | null }
    expect(body.updated_at).toBeNull()
  })
})
