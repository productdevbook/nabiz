import { describe, expect, test } from "bun:test"

import { alert } from "../src/lib/alert.ts"
import type { Monitor } from "../src/lib/probe.ts"

const monitor = { id: 1, slug: "api", name: "API" } as Monitor
const change = { monitor, ok: false, heldFor: null }

interface Attempt {
  url: string
  signal: AbortSignal | undefined
}

function watching(answer: () => Promise<Response>) {
  const tried: Attempt[] = []
  const real = globalThis.fetch
  globalThis.fetch = ((url: string, init: { signal?: AbortSignal }) => {
    tried.push({ url: String(url), signal: init.signal })
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
