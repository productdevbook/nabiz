// A claim in prose is checked against the code it describes, on every
// surface that carries it — the README, docs/, and llms.txt, which is
// prose that happens to live in src/lib/api.ts and has twice been the one
// place a corrected claim was left standing.
import { expect, test } from "bun:test"

import { LANGS } from "../src/lib/i18n.ts"
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
  // In the table, not merely somewhere in the file: a route mentioned in a
  // sentence is not a route a reader can find in the list.
  const listed = new Set([...api.matchAll(/^\|\s*`(\/[^`]*)`/gm)].map((m) => m[1] as string))
  const undocumented = routePaths().filter((p) => !skip.has(p) && !listed.has(p))
  expect(undocumented).toEqual([])
  // And the other direction: a row in that table for a route that does not
  // exist is a documented 404.
  const invented = [...listed].filter((p) => !has(routeFile(p)))
  expect(invented).toEqual([])
})

test("every environment variable the code reads is in docs/configuration.md", () => {
  const config = read("docs/configuration.md")
  const names = new Set<string>()
  for (const f of [...walk("src", ".ts"), ...walk("src", ".astro")])
    // Both ways a name can be read off the environment: a name that is
    // only ever reached by bracket is still a name an operator must set.
    for (const m of read(f).matchAll(
      /(?:process\.)?env(?:\.([A-Z][A-Z_0-9]+)|\["([A-Z][A-Z_0-9]+)"\])/g,
    ))
      names.add((m[1] ?? m[2]) as string)
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
  // A number written as a digit counts too — spelling it was never the
  // rule, counting right was.
  const said =
    /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+endpoints\s+to\s+read/i.exec(api)
  expect(said).not.toBeNull()
  const word = (said as RegExpExecArray)[1] as string
  const rows = [...api.matchAll(/^\|\s*`(\/[^`]*)`/gm)].length
  expect(rows).toBe(WORDS[word.toLowerCase()] ?? Number(word))
})

test("schema.sql creates every table before it creates any index", () => {
  // The file is applied to databases that already exist, and one failing
  // statement takes every statement under it with it: a v3.9.0 file put
  // an index over a new column above the notices table, so a database
  // upgrading from v1.0.0 lost the table rather than gained the index.
  const sql = read("schema.sql")
  // By keyword, not by substring: `create index` in lower case, and
  // `CREATE UNIQUE INDEX`, both walked around the first version of this.
  const at = (re: RegExp) => [...sql.matchAll(re)].map((m) => m.index as number)
  const tables = at(/^\s*create\s+table\b/gim)
  const indexes = at(/^\s*create\s+(unique\s+)?index\b/gim)
  expect(tables.length).toBeGreaterThan(3)
  expect(indexes.length).toBeGreaterThan(3)
  expect(Math.min(...indexes) > Math.max(...tables)).toBe(true)
})

test("what the code publishes as its version is what the release is", () => {
  // The image tag comes from the git tag and the header comes from this
  // constant; nothing in the build compares them, so the workflow does.
  const release = read(".github/workflows/release.yml")
  const gate = release.indexOf("the tag, the package and the header agree")
  const check = release.indexOf("bun run check")
  const push = release.indexOf("push: true")
  expect(gate).toBeGreaterThan(-1)
  expect(check).toBeGreaterThan(-1)
  expect(push).toBeGreaterThan(-1)
  // Before the push, or they guard nothing: the first version of this rule
  // asked only that the two strings appeared somewhere in the file, and
  // moving `bun run check` to the last step of the job passed it.
  expect(gate < push && check < push).toBe(true)
})

test("a document that lists the languages lists the ones there are", () => {
  // Adding a language is nine edits outside its own block, and this is
  // what makes the ninth one fail loudly rather than sit there as a
  // sentence naming five of six.
  const codes = new Set(LANGS)
  const wrong: string[] = []
  for (const { name, text } of PROSE)
    // By paragraph, not by line: a list long enough to wrap is still one
    // list, and a rule that reads lines would ask for it on one.
    for (const line of text.split(/\n\s*\n/)) {
      // A run of language codes: two or more separated by commas or pipes,
      // whatever punctuation the document uses around them.
      const runs = line.matchAll(
        /\b(?:en|tr|de|es|fr|zh-CN)\b(?:[`,|\s]+`?\b(?:en|tr|de|es|fr|zh-CN)\b`?)+/g,
      )
      for (const run of runs) {
        const found = new Set((run[0].match(/\b(?:en|tr|de|es|fr|zh-CN)\b/g) ?? []) as string[])
        // Only a line that is trying to be the list, not one that names
        // two of them to make a point.
        if (found.size < 3) continue
        const missing = [...codes].filter((c) => !found.has(c))
        if (missing.length > 0)
          wrong.push(`${name}: ${missing.join(", ")} missing from "${run[0]}"`)
      }
    }
  expect(wrong).toEqual([])
})
