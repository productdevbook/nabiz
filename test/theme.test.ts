// "Colors are green-tempered neutrals defined three times (:root, the
// prefers-color-scheme: dark block guarded with :not([data-theme="light"]),
// and [data-theme="dark"]) — a color defined in only one of them is a
// bug." The rule holds today; this is what keeps it holding.
import { expect, test } from "bun:test"

import { read } from "./source.ts"

const css = read("src/styles.css")

/** Every rule matching, from each selector to the brace that closes it —
 *  every one, because a token declared in a second `prefers-color-scheme`
 *  block was invisible to a version of this that read only the first. */
function bodies(start: RegExp): string[] {
  return [...css.matchAll(start)].map((m) => from(m.index))
}

function from(at: number): string {
  let depth = 0
  for (let i = at; i < css.length; i += 1) {
    if (css[i] === "{") depth += 1
    else if (css[i] === "}") {
      depth -= 1
      if (depth === 0) return css.slice(at, i)
    }
  }
  return css.slice(at)
}

const declared = (text: string) => new Set([...text.matchAll(/^\s*(--[\w-]+):/gm)].map((d) => d[1]))

const light = declared(bodies(/^ {2}:root \{/gm).join("\n"))
const media = declared(bodies(/^ {2}@media \(prefers-color-scheme: dark\) \{/gm).join("\n"))
const attribute = declared(bodies(/^ {2}:root\[data-theme="dark"\] \{/gm).join("\n"))

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

test("a colour is a token, or it is the same colour in both themes", () => {
  // The rule above compares which token names are declared three times,
  // so a colour that is not a token at all was invisible to it — which is
  // exactly how the dialog's shadow, its backdrop and the select's chevron
  // were light-theme literals reused unchanged in the dark.
  const blocks = new Set([
    ...bodies(/^ {2}:root \{/gm),
    ...bodies(/^ {2}@media \(prefers-color-scheme: dark\) \{/gm),
    ...bodies(/^ {2}:root\[data-theme="dark"\] \{/gm),
    ...bodies(/^ {2}:root\[data-theme="light"\] \{/gm),
  ])
  let outside = css
  for (const block of blocks) outside = outside.replace(block, "")
  const SAFE = [
    // A mask is a shape, not a colour: what shows through it is the token
    // painted behind it.
    /stroke="black"/,
    // The one place a hue is mixed with the surface it sits on, from two
    // tokens.
    /color-mix\(/,
  ]
  const wrong: string[] = []
  for (const line of outside.split("\n")) {
    if (SAFE.some((re) => re.test(line))) continue
    if (/^\s*(\/\*|\*|\/\/)/.test(line)) continue
    if (/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/.test(line)) wrong.push(line.trim())
  }
  expect(wrong).toEqual([])
})
