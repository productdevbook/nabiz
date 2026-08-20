// Anything remembered between requests has to name its writer and its
// owner. The hold shipped in 3.6.0 needed three follow-up fixes: it was
// invalidated on a map the render never read (two module copies), it was
// invalidated before the writes rather than after, and a read that spanned
// a write put its half-written snapshot back.
import { expect, test } from "bun:test"

import { read, walk } from "./source.ts"

const store = read("src/lib/store.ts")

/** Every rule below is about a value held between requests. Before there
 *  was one, there is nothing here to keep. */
const holds = /PAGE_MS|holdFor|\bforget\s*\(/.test(store)

/** Split a module into its exported top-level functions. */
function exportedFunctions(text: string): { name: string; body: string }[] {
  const out: { name: string; body: string }[] = []
  const re = /^export (?:async )?function (\w+)/gm
  const heads = [...text.matchAll(re)]
  heads.forEach((m, i) => {
    const from = m.index
    const to = heads[i + 1]?.index ?? text.length
    out.push({ name: m[1] as string, body: text.slice(from, to) })
  })
  return out
}

test("every function that writes forgets what the page remembers", () => {
  if (!holds) return
  const wrong: string[] = []
  for (const { name, body } of exportedFunctions(store)) {
    const writes = /\b(INSERT|UPDATE|DELETE)\b/.test(body)
    if (!writes) continue
    if (!/\bforget\s*\(/.test(body)) wrong.push(`${name} writes and does not forget`)
  }
  expect(wrong).toEqual([])
})

test("the round forgets after its writes, not before them", () => {
  if (!holds) return
  const record = exportedFunctions(store).find((f) => f.name === "record")
  expect(record).toBeDefined()
  const body = (record as { body: string }).body
  const batch = body.lastIndexOf("db.batch")
  const forgets = body.indexOf("forget(", batch)
  expect(forgets).toBeGreaterThan(batch)
  // In a finally, so a write that throws halfway still drops the hold.
  expect(/finally\s*\{[^}]*forget\(/.test(body)).toBe(true)
})

test("a read that spans a write is served but not remembered", () => {
  if (!holds) return
  // Deleting the entry is not enough: a render that began before the round
  // and finished after it would otherwise store the half-round it saw.
  expect(/writes\.n/.test(store)).toBe(true)
  expect(/if \(writes\.n === began\)/.test(store)).toBe(true)
})

test("anything remembered across requests is pinned across both copies", () => {
  if (!holds) return
  // src/lib is instantiated twice in a server: once inside the Astro
  // bundle that renders, once from source in the process that probes. A
  // module-local map is two maps, and the writer clears the wrong one.
  const KNOWN: Record<string, string> = {
    "src/lib/store.ts:WeakMap": "pinned on globalThis as nabizPage",
    // Keyed on the PageData object the pinned store hands out, so the two
    // copies cannot disagree about which round they are shaping.
    "src/lib/shape.ts:WeakMap": "keyed on the pinned store's own object",
    // Per-isolate by design: the throttle is a brake on one connection
    // into one colo, and says so.
    "src/lib/api.ts:Map": "per-isolate brake, documented as such",
  }
  const found: string[] = []
  for (const f of walk("src/lib", ".ts")) {
    const text = read(f)
    for (const m of text.matchAll(/^(?:const|let)\s+\w+\s*=\s*.*?new (Weak)?Map\s*</gm))
      found.push(`${f}:${m[1] === "Weak" ? "Weak" : ""}Map`)
  }
  const unclassified = found.filter((k) => !(k in KNOWN))
  expect(unclassified).toEqual([])
  // And the store's own one is pinned, not merely classified.
  expect(/globalThis as/.test(store)).toBe(true)
  expect(/across\.nabizPage/.test(store)).toBe(true)
})

test("the round warms everything a request would otherwise pay for", () => {
  // The work of shaping a group is proportional to how many members it
  // hides, so a request that pays it publishes that number as latency.
  // The round rebuilds the page itself for exactly that reason — and it
  // has to rebuild all of it, not the database read alone.
  const beat = read("src/server/index.ts")
  const memoised = /const shaped = new WeakMap/.test(read("src/lib/shape.ts"))
  if (!memoised) return
  const warms = [
    /\bforPage\s*\(/.test(beat) ? null : "the round does not warm forPage",
    // And warming it from the process only helps if the memo is the same
    // object the bundle reads: src/server/env.ts pins the handle for this
    // reason, and src/lib/store.ts pins the page for the same one.
    /globalThis/.test(read("src/lib/shape.ts"))
      ? null
      : "the shaping memo is not pinned across the bundle and the process",
    /\brows\s*\(/.test(beat)
      ? null
      : "the round does not warm rows(); the first reader pays the shaping",
  ].filter((x) => x !== null)
  expect(warms).toEqual([])
})
