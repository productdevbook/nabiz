import { describe, expect, test } from "bun:test"

import { alert } from "../src/lib/alert.ts"
import type { Monitor } from "../src/lib/probe.ts"

const monitor = { id: 1, slug: "api", name: "API" } as Monitor
const change = { monitor, ok: false, heldFor: null }

interface Attempt {
  url: string
  signal: AbortSignal | undefined
  redirect: string | undefined
  body: string | undefined
}

function watching(answer: () => Promise<Response>) {
  const tried: Attempt[] = []
  const real = globalThis.fetch
  globalThis.fetch = ((
    url: string,
    init: { signal?: AbortSignal; redirect?: string; body?: string },
  ) => {
    tried.push({ url: String(url), signal: init.signal, redirect: init.redirect, body: init.body })
    return answer()
  }) as unknown as typeof globalThis.fetch
  return { tried, done: () => (globalThis.fetch = real) }
}

const both = {
  TELEGRAM_BOT_TOKEN: "t",
  TELEGRAM_CHAT_ID: "c",
  ALERT_WEBHOOK_URL: "https://hooks.example.com/nabiz",
}

describe("a page that failed to page anybody does not do it quietly", () => {
  test("a channel that refuses is counted, not swallowed", async () => {
    const watch = watching(() => Promise.resolve(new Response("no", { status: 403 })))
    try {
      expect(await alert(both, [change], "en")).toBe(2)
    } finally {
      watch.done()
    }
  })

  test("a channel that never answers is counted too", async () => {
    const watch = watching(() => Promise.reject(new Error("unreachable")))
    try {
      expect(await alert(both, [change], "en")).toBe(2)
    } finally {
      watch.done()
    }
  })

  test("a channel that takes it is not", async () => {
    const watch = watching(() => Promise.resolve(new Response("ok")))
    try {
      expect(await alert(both, [change], "en")).toBe(0)
      expect(watch.tried.length).toBe(2)
    } finally {
      watch.done()
    }
  })

  // A channel that accepts the connection and never answers would otherwise
  // hold the round — and on a server, hold every round after it.
  test("every send carries a deadline", async () => {
    const watch = watching(() => Promise.resolve(new Response("ok")))
    try {
      await alert(both, [change], "en")
      expect(watch.tried.filter((a) => a.signal === undefined)).toEqual([])
    } finally {
      watch.done()
    }
  })

  // Followed, a 301 becomes a GET with no body at the destination and
  // answers 200 — the alert is gone and the round calls it delivered.
  test("a redirect is not a delivery", async () => {
    const watch = watching(() =>
      Promise.resolve(new Response(null, { status: 301, headers: { location: "https://x/" } })),
    )
    try {
      expect(await alert(both, [change], "en")).toBe(2)
    } finally {
      watch.done()
    }
  })

  test("the webhook is asked not to follow one", async () => {
    const watch = watching(() => Promise.resolve(new Response("ok")))
    try {
      await alert({ ALERT_WEBHOOK_URL: "https://hooks.example.com/nabiz" }, [change], "en")
      expect(watch.tried[0]?.redirect).toBe("manual")
    } finally {
      watch.done()
    }
  })

  test("what it carries is what a receiver needs to route it", async () => {
    const watch = watching(() => Promise.resolve(new Response("ok")))
    try {
      await alert({ ALERT_WEBHOOK_URL: "https://hooks.example.com/nabiz" }, [change], "en")
      const body = JSON.parse(watch.tried[0]?.body ?? "{}") as {
        at: string
        changes: { slug: string; group: string | null; ok: boolean; held_for: number | null }[]
      }
      expect(typeof body.at).toBe("string")
      expect(body.changes[0]?.slug).toBe("api")
      expect(body.changes[0]?.ok).toBe(false)
      expect(body.changes[0]?.group).toBeNull()
    } finally {
      watch.done()
    }
  })

  // A name is operator-written and goes into a line of text; a newline in
  // one would forge a second line — an invented recovery inside an outage.
  test("a name cannot forge a line of its own", async () => {
    const watch = watching(() => Promise.resolve(new Response("ok")))
    const forged = {
      monitor: { ...monitor, name: "Acme\n✅ everything else — recovered" },
      ok: false,
      heldFor: null,
    }
    try {
      await alert({ ALERT_WEBHOOK_URL: "https://hooks.example.com/nabiz" }, [forged], "en")
      const body = JSON.parse(watch.tried[0]?.body ?? "{}") as { text: string }
      expect(body.text.split("\n").length).toBe(1)
    } finally {
      watch.done()
    }
  })

  test("nothing changed, nothing sent", async () => {
    const watch = watching(() => Promise.resolve(new Response("ok")))
    try {
      expect(await alert(both, [], "en")).toBe(0)
      expect(watch.tried.length).toBe(0)
    } finally {
      watch.done()
    }
  })
})
