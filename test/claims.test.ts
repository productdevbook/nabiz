// A claim in prose is checked against the code it describes, on every
// surface that carries it — the README, docs/, and llms.txt, which is
// prose that happens to live in src/lib/api.ts and has twice been the one
// place a corrected claim was left standing.
import { expect, test } from "bun:test"

import { has, read, walk } from "./source.ts"

const PROSE: { name: string; text: string }[] = [
  { name: "README.md", text: read("README.md") },
  ...walk("docs", ".md").map((f) => ({ name: f, text: read(f) })),
  // llms.txt is generated, so its prose is source.
  { name: "src/lib/api.ts (llms.txt)", text: read("src/lib/api.ts") },
]

/** `/api/status.json` is written by `src/pages/api/status.json.ts`; the
 *  page itself by `index.astro`. */
function routeFile(path: string): string {
  if (path === "" || path === "/") return "src/pages/index.astro"
  return `src/pages${path}.ts`
}

function routePaths(): string[] {
  return walk("src/pages", ".ts")
    .map((f) => f.replace(/^src\/pages/, "").replace(/\.ts$/, ""))
    .concat("/")
}

test("every endpoint llms.txt links to is a route that exists", () => {
  const llms = read("src/lib/api.ts")
  const links = [...llms.matchAll(/\]\(\$\{origin\}(\/[^)\s]*)\)/g)].map((m) => m[1] as string)
  expect(links.length).toBeGreaterThan(3)
  const missing = links.filter((p) => !has(routeFile(p === "/" ? "/" : p)))
  expect(missing).toEqual([])
})

test("every route that exists is in the docs' endpoint table", () => {
  const api = read("docs/api.md")
  // Write endpoints and the page are described in prose elsewhere; the
  // table is for what a reader can GET.
  const skip = new Set(["/api/notice", "/api/notice/resolve", "/"])
  const undocumented = routePaths().filter((p) => !skip.has(p) && !api.includes(p))
  expect(undocumented).toEqual([])
})

test("every environment variable the code reads is in docs/configuration.md", () => {
  const config = read("docs/configuration.md")
  const names = new Set<string>()
  for (const f of [...walk("src", ".ts"), ...walk("src", ".astro")])
    for (const m of read(f).matchAll(/(?:process\.)?env\.([A-Z][A-Z_0-9]+)/g))
      names.add(m[1] as string)
  // DB is the D1 binding, named in wrangler.toml, not an environment
  // variable an operator sets.
  names.delete("DB")
  const undocumented = [...names].filter((n) => !config.includes(n)).toSorted()
  expect(undocumented).toEqual([])
})

test("nothing calls a read uncached while the store holds it", () => {
  const store = read("src/lib/store.ts")
  const holds = /hold\.ms|PAGE_MS|holdFor/.test(store)
  if (!holds) return
  const lying = PROSE.filter(({ text }) =>
    /\buncached\b|not cached|what is true at the moment you asked/i.test(text),
  ).map(({ name }) => name)
  expect(lying).toEqual([])
})

test("a paragraph about ?lang= names the endpoints that read it", () => {
  const readers = walk("src/pages", ".ts")
    .concat(walk("src/pages", ".astro"))
    .filter((f) => /searchParams\.(get|has)\(\s*"lang"/.test(read(f)))
  expect(readers.length).toBeGreaterThan(1)
  const wrong: string[] = []
  for (const { name, text } of PROSE)
    for (const para of text.split(/\n\s*\n/)) {
      if (!para.includes("?lang=")) continue
      if (/\b(every|all|each)\s+(read\s+)?endpoint/i.test(para)) wrong.push(`${name}: quantifier`)
      for (const f of readers) {
        const named = f.includes("index.astro")
          ? /\bpage\b|`\/`/.test(para)
          : para
              .toLowerCase()
              .includes(((f.split("/").pop() as string).split(".")[0] as string).toLowerCase())
        if (!named) wrong.push(`${name}: silent about ${f}`)
      }
    }
  expect(wrong).toEqual([])
})

const WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
}

test("a document that counts its endpoints counts the ones it lists", () => {
  const api = read("docs/api.md")
  const said = /\b(one|two|three|four|five|six|seven|eight|nine|ten)\s+endpoints\s+to\s+read/i.exec(
    api,
  )
  if (said === null) return
  const rows = [...api.matchAll(/^\|\s*`(\/[^`]*)`/gm)].length
  expect(rows).toBe(WORDS[(said[1] as string).toLowerCase()] as number)
})
