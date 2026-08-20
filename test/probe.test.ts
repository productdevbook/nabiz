import { describe, expect, test } from "bun:test"

import type { Monitor } from "../src/lib/probe.ts"
import { probe } from "../src/lib/probe.ts"

const monitor = (over: Partial<Monitor> = {}): Monitor =>
  ({
    id: 1,
    slug: "api",
    name: "API",
    url: "https://api.example.com/health",
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
  }) as Monitor

interface Asked {
  url: string
  init: { method?: string; redirect?: string; cache?: string; signal?: AbortSignal }
}

function answering(answer: () => Promise<Response>) {
  const asked: Asked[] = []
  const real = globalThis.fetch
  globalThis.fetch = ((url: string, init: Asked["init"]) => {
    asked.push({ url: String(url), init })
    return answer()
  }) as unknown as typeof globalThis.fetch
  return { asked, done: () => (globalThis.fetch = real) }
}

describe("a probe believes the promise, not the connection", () => {
  test("the promised status is what up means", async () => {
    const watch = answering(() => Promise.resolve(new Response("", { status: 200 })))
    try {
      expect((await probe(monitor())).ok).toBe(true)
    } finally {
      watch.done()
    }
  })

  test("another status is down, whatever it is", async () => {
    const watch = answering(() => Promise.resolve(new Response("", { status: 204 })))
    try {
      const r = await probe(monitor())
      expect(r.ok).toBe(false)
      expect(r.status).toBe(204)
    } finally {
      watch.done()
    }
  })

  // A 301 where a 200 was promised is a finding, not a detour to take
  // quietly — and a cached 200 can mask an outage, so the probe must reach
  // the origin.
  test("redirects are not followed and caches are not consulted", async () => {
    const watch = answering(() => Promise.resolve(new Response("", { status: 301 })))
    try {
      const r = await probe(monitor())
      expect(r.ok).toBe(false)
      expect(watch.asked[0]?.init.redirect).toBe("manual")
      expect(watch.asked[0]?.init.cache).toBe("no-store")
      expect(watch.asked[0]?.init.signal).toBeDefined()
    } finally {
      watch.done()
    }
  })

  test("a 200 without the promised words is still a failure", async () => {
    const watch = answering(() => Promise.resolve(new Response("database error", { status: 200 })))
    try {
      expect((await probe(monitor({ expect_body: "all systems" }))).ok).toBe(false)
    } finally {
      watch.done()
    }
  })

  test("a 200 with them is not", async () => {
    const watch = answering(() =>
      Promise.resolve(new Response("all systems nominal", { status: 200 })),
    )
    try {
      expect((await probe(monitor({ expect_body: "all systems" }))).ok).toBe(true)
    } finally {
      watch.done()
    }
  })

  test("a connection that fails is down with nothing to report", async () => {
    const watch = answering(() => Promise.reject(new Error("ECONNREFUSED")))
    try {
      const r = await probe(monitor())
      expect(r.ok).toBe(false)
      expect(r.status).toBeNull()
      expect(r.ms).toBeGreaterThan(-1)
    } finally {
      watch.done()
    }
  })

  test("the method is the one the row asks for", async () => {
    const watch = answering(() => Promise.resolve(new Response("", { status: 200 })))
    try {
      await probe(monitor({ method: "HEAD" }))
      expect(watch.asked[0]?.init.method).toBe("HEAD")
    } finally {
      watch.done()
    }
  })
})
