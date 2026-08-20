// A rule that holds on one surface holds on its siblings. Every defect
// this file is written for was a rule kept in one endpoint and not in the
// one beside it: the empty ?lang=, /health's missing CORS, three event
// windows for the same list, a redirect refused by the probe and followed
// by the alert.
import { expect, test } from "bun:test"

import { callAt, callsTo, read, walk } from "./source.ts"

const PAGES = [...walk("src/pages", ".ts"), ...walk("src/pages", ".astro")]
const ANSWERS = [...PAGES, "src/lib/api.ts"]
const LIB = walk("src/lib", ".ts")

test("an empty ?lang= is not an answer on any surface", () => {
  // `get()` returns "" for `?lang=`, and "" ?? x is "" — so the fallback
  // the deployment configured is thrown away. `||`, never `??`, and the
  // exemption for `?? undefined` was the one that survived: it feeds ""
  // to langOf, which answers English to a page that speaks Turkish.
  const wrong: string[] = []
  for (const f of PAGES)
    for (const m of read(f).matchAll(/searchParams\.get\(\s*"lang"\s*\)\s*\?\?/g))
      wrong.push(`${f}: ${m[0]}`)
  // And the question itself is not enough: asking `has("lang")` says a
  // language was named, not that one was given.
  for (const f of PAGES)
    if (/searchParams\.has\(\s*"lang"\s*\)/.test(read(f))) wrong.push(`${f}: has("lang")`)
  expect(wrong).toEqual([])
})

test("every read endpoint answers a page somewhere else", () => {
  // CORS-open is the courtesy this API advertises, and a preflight it
  // answers 204 to is a promise the real answer keeps too — including the
  // refusals, which are the answers a browser most needs to read.
  const wrong: string[] = []
  for (const f of ANSWERS) {
    const text = read(f)
    for (const call of [...callsTo(text, "new Response"), ...callsTo(text, "Response.json")]) {
      // A response with no headers at all carries no CORS either; not
      // having any is not an exemption from having that one.
      // robots.txt is read by crawlers, never by a script in a page.
      if (f.endsWith("robots.txt.ts")) continue
      if (/access-control-allow-origin|\.\.\.CORS/.test(call)) continue
      wrong.push(`${f}: ${(call.split("\n")[0] as string).trim()}…`)
    }
  }
  expect(wrong).toEqual([])
})

test("the page, the JSON and the feed read the same width of events", () => {
  // Three widths meant a group in permanent trouble emptied one surface
  // while another still had entries. One constant, or none of them agree.
  const wrong: string[] = []
  for (const f of [...PAGES, ...LIB])
    for (const call of callsTo(read(f), "recentEvents")) {
      const arg = (call.split(",")[1] ?? "").trim().replace(/\)$/, "")
      // The declaration is not a call site.
      if (arg.includes(":")) continue
      // The constant itself, not an expression mentioning it: `EVENT_ROWS
      // * 3` is three different widths again.
      if (arg !== "EVENT_ROWS") wrong.push(`${f}: recentEvents(…, ${arg})`)
    }
  expect(wrong).toEqual([])
})

test("nothing this process sends out follows a redirect or waits forever", () => {
  // A 301 makes a POST a bodyless GET at the destination and answers 200:
  // the alert is gone and the send reports success. The probe has refused
  // to follow one since the beginning; the alert path did the opposite
  // for four releases.
  const wrong: string[] = []
  // Everything this process sends, not only the library: a fetch added to
  // the server entry or a route sends just as far. The .astro file is not
  // here on purpose — its fetches are the inline script's, running in the
  // reader's browser, where following a redirect is the right thing.
  for (const f of [
    ...LIB,
    ...walk("src/server", ".ts"),
    ...walk("src/pages", ".ts"),
    // The Cloudflare entry point, which is at src/ and was in no list.
    "src/worker.ts",
  ]) {
    const text = read(f)
    for (const m of text.matchAll(/(?<![.\w])fetch\s*\(/g)) {
      // The worker's own `async fetch(request, env, ctx)` is the entry
      // point, not a call: what it answers is nothing this process sends.
      if (/\b(async|function)\s+$/.test(text.slice(Math.max(0, m.index - 12), m.index))) continue
      const call = callAt(text, m.index + m[0].length - 1)
      if (!/redirect:\s*"(manual|error)"/.test(call)) wrong.push(`${f}: follows redirects`)
      if (!/\bsignal\b\s*[,:]/.test(call)) wrong.push(`${f}: no deadline`)
    }
  }
  expect(wrong).toEqual([])
})

test("a name an operator writes is escaped everywhere it is printed", () => {
  // The RSS <link> carried the Host header raw for four releases while
  // every other string in that document went through escXml, and the
  // day-bar tooltips printed a translation into an attribute unescaped.
  // Every interpolation into an attribute or into the feed either escapes
  // or is named below with the reason it cannot carry a character.
  const SAFE = [
    /^esc\(/,
    /^escXml\(/,
    // Values this code computes: a date, a class, a geometry, a rowid.
    /^(day|cls|dot|w|h|lw|vw|color|label|state|area|line|here)$/,
    /^(n|e|r|d)\.(id|at|ok)$/,
    /^(ex|ey|lw|vw|x|y)[^"]*toFixed/,
    /^(lw|vw|w|h)\s*[-+*/]/,
    /^percent\(/,
    /^when\(/,
    /^new Date\(/,
    /^e\.ok \? "ok" : "bad"$/,
    /^String\(WINDOW\)$/,
    // Already escaped, stripped out below before the line is read.
    /^SAFE$/,
    // A translation, held against markup characters by test/i18n.test.ts.
    /^t\(lang/,
  ]
  const safe = (expr: string) => SAFE.some((re) => re.test(expr))
  const wrong: string[] = []
  for (const f of ["src/lib/render.ts", "src/lib/api.ts", "src/pages/index.astro"]) {
    const text = read(f)
    for (const raw of text.split("\n")) {
      // An escaping call and everything inside it — including a nested
      // template — is the answer, not the question.
      let line = raw
      for (let i = 0; i < 4; i += 1)
        line = line.replace(/\besc(Xml)?\((?:[^()]|\([^()]*\))*\)/g, "SAFE")
      // An attribute value, anywhere markup is written as a string.
      for (const m of line.matchAll(/="[^"]*?\$\{([^{}]+)\}/g))
        if (!safe((m[1] as string).trim())) wrong.push(`${f}: attribute \${${m[1] as string}}`)
      // And the feed, whose whole document is lost to one stray character.
      if (!/<(item|title|description|link|guid|rss)/.test(line)) continue
      for (const m of line.matchAll(/>[^<>]*?\$\{([^{}]+)\}/g))
        if (!safe((m[1] as string).trim())) wrong.push(`${f}: xml \${${m[1] as string}}`)
    }
  }
  expect(wrong).toEqual([])
})
