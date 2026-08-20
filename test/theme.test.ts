// "Colors are green-tempered neutrals defined three times (:root, the
// prefers-color-scheme: dark block guarded with :not([data-theme="light"]),
// and [data-theme="dark"]) — a color defined in only one of them is a
// bug." The rule holds today; this is what keeps it holding.
import { expect, test } from "bun:test"

import { read } from "./source.ts"

const css = read("src/styles.css")

/** A rule's whole body, from its selector to the brace that closes it. */
function body(start: RegExp): string {
  const m = start.exec(css)
  expect(m).not.toBeNull()
  const from = (m as RegExpExecArray).index
  let depth = 0
  for (let i = from; i < css.length; i += 1) {
    if (css[i] === "{") depth += 1
    else if (css[i] === "}") {
      depth -= 1
      if (depth === 0) return css.slice(from, i)
    }
  }
  return css.slice(from)
}

const declared = (text: string) => new Set([...text.matchAll(/^\s*(--[\w-]+):/gm)].map((d) => d[1]))

const light = declared(body(/^ {2}:root \{/m))
const media = declared(body(/^ {2}@media \(prefers-color-scheme: dark\) \{/m))
const attribute = declared(body(/^ {2}:root\[data-theme="dark"\] \{/m))

test("the light theme declares something to theme", () => {
  expect(light.size).toBeGreaterThan(10)
})

test("every token the light theme declares, both dark blocks declare too", () => {
  expect([...light].filter((n) => !media.has(n))).toEqual([])
  expect([...light].filter((n) => !attribute.has(n))).toEqual([])
})

test("neither dark block declares a token the light theme has not got", () => {
  // One defined only in the dark is a colour with no light value at all:
  // the guard means it is simply absent when the system asks for light.
  expect([...media].filter((n) => !light.has(n))).toEqual([])
  expect([...attribute].filter((n) => !light.has(n))).toEqual([])
})

test("the dark media block is guarded, or an explicit light theme loses", () => {
  expect(
    /@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme="light"\]\)/.test(css),
  ).toBe(true)
})
