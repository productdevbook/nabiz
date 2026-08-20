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

describe("a failure says which kind of failure it was", () => {
  test("a promised status with the wrong words in it is not the status code's fault", async () => {
    const watch = answering(() => Promise.resolve(new Response("database error", { status: 200 })))
    try {
      const r = await probe(monitor({ expect_body: "all systems" }))
      expect(r.ok).toBe(false)
      // 200 is what it answered; the reason it is red is the body.
      expect(r.status).toBe(200)
      expect(r.reason).toBe("body")
    } finally {
      watch.done()
    }
  })

  test("a connection that never happened is not a timeout", async () => {
    const watch = answering(() => Promise.reject(new Error("ECONNREFUSED")))
    try {
      expect((await probe(monitor())).reason).toBe("unreachable")
    } finally {
      watch.done()
    }
  })

  test("a probe stopped by its own deadline says so", async () => {
    const watch = answering(
      () => new Promise((_, reject) => setTimeout(() => reject(new Error("aborted")), 60)),
    )
    try {
      const r = await probe(monitor({ timeout_ms: 20 }))
      expect(r.ok).toBe(false)
      expect(r.reason).toBe("timeout")
    } finally {
      watch.done()
    }
  })

  test("a wrong status code needs no reason beyond itself", async () => {
    const watch = answering(() => Promise.resolve(new Response("", { status: 503 })))
    try {
      const r = await probe(monitor())
      expect(r.status).toBe(503)
      expect(r.reason).toBeNull()
    } finally {
      watch.done()
    }
  })
})

/** An origin that answers and then keeps talking. `made` counts what it
 *  actually produced, so a cap can be measured rather than assumed. */
function talking(chunk: number, chunks: number, word?: { at: number; text: string }) {
  const made = { bytes: 0 }
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (made.bytes >= chunk * chunks) {
        controller.close()
        return
      }
      const part = new Uint8Array(chunk).fill(0x61)
      if (word !== undefined && word.at >= made.bytes && word.at < made.bytes + chunk)
        new TextEncoder().encodeInto(word.text, part.subarray(word.at - made.bytes))
      made.bytes += chunk
      controller.enqueue(part)
    },
  })
  return { made, body }
}

describe("a body is read, and only so much of it", () => {
  test("an answer that never ends is still an answer, and costs a fixed read", async () => {
    const origin = talking(16 * 1024, 4096)
    const watch = answering(() => Promise.resolve(new Response(origin.body, { status: 200 })))
    try {
      const r = await probe(monitor())
      expect(r.ok).toBe(true)
      // 64 KiB, whatever the origin had queued behind it.
      expect(origin.made.bytes <= 64 * 1024 + 16 * 1024).toBe(true)
    } finally {
      watch.done()
    }
  })

  test("a chunk larger than the cap is cut, not taken whole", async () => {
    // One megabyte in a single chunk, with the word past the cap inside
    // it: taking the chunk whole because it is the first would make the
    // runtime's chunk size decide how much of a body is read.
    const origin = talking(1024 * 1024, 1, { at: 70_000, text: "ready" })
    const watch = answering(() => Promise.resolve(new Response(origin.body, { status: 200 })))
    try {
      const r = await probe(monitor({ expect_body: "ready" }))
      expect(r.ok).toBe(false)
      expect(r.reason).toBe("body")
    } finally {
      watch.done()
    }
  })

  test("the promised words are found up to the cap and not beyond it", async () => {
    const near = talking(64 * 1024, 2, { at: 65_000, text: "ready" })
    let watch = answering(() => Promise.resolve(new Response(near.body, { status: 200 })))
    try {
      expect((await probe(monitor({ expect_body: "ready" }))).ok).toBe(true)
    } finally {
      watch.done()
    }
    const far = talking(64 * 1024, 4, { at: 200_000, text: "ready" })
    watch = answering(() => Promise.resolve(new Response(far.body, { status: 200 })))
    try {
      const r = await probe(monitor({ expect_body: "ready" }))
      expect(r.ok).toBe(false)
      expect(r.reason).toBe("body")
      expect(r.status).toBe(200)
    } finally {
      watch.done()
    }
  })

  test("latency is time to the answer, not time to the body", async () => {
    const slow = new ReadableStream<Uint8Array>({
      async pull(controller) {
        await new Promise((go) => setTimeout(go, 120))
        controller.enqueue(new Uint8Array(8).fill(0x61))
        controller.close()
      },
    })
    const watch = answering(() => Promise.resolve(new Response(slow, { status: 200 })))
    try {
      const r = await probe(monitor())
      expect(r.ok).toBe(true)
      // The body took 120 ms; the answer took none of it.
      expect(r.ms < 60).toBe(true)
    } finally {
      watch.done()
    }
  })

  test("an answer that stops halfway keeps the status it was given", async () => {
    const broken = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(16).fill(0x61))
        controller.error(new Error("the connection went away"))
      },
    })
    const watch = answering(() => Promise.resolve(new Response(broken, { status: 200 })))
    try {
      const r = await probe(monitor())
      expect(r.ok).toBe(false)
      expect(r.status).toBe(200)
      expect(r.reason).toBe("incomplete")
    } finally {
      watch.done()
    }
  })

  test("a body that runs out our clock is a timeout, not the host stopping", async () => {
    let signal: AbortSignal | undefined
    const real = globalThis.fetch
    globalThis.fetch = ((_url: string, init: { signal?: AbortSignal }) => {
      signal = init.signal
      const stalls = new ReadableStream<Uint8Array>({
        pull(controller) {
          return new Promise((_, fail) =>
            signal?.addEventListener("abort", () => {
              controller.error(new Error("aborted"))
              fail(new Error("aborted"))
            }),
          )
        },
      })
      return Promise.resolve(new Response(stalls, { status: 200 }))
    }) as unknown as typeof globalThis.fetch
    try {
      const r = await probe(monitor({ timeout_ms: 40 }))
      expect(r.ok).toBe(false)
      expect(r.status).toBe(200)
      expect(r.reason).toBe("timeout")
    } finally {
      globalThis.fetch = real
    }
  })
})
