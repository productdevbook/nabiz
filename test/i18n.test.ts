import { describe, expect, test } from "bun:test"

import { KEYS, LANGS, langOf, t, table } from "../src/lib/i18n.ts"

describe("every language, none of them half-finished", () => {
  test("every language answers every key with something non-empty", () => {
    const empty: string[] = []
    for (const lang of LANGS)
      for (const key of KEYS) if (t(lang, key).trim() === "") empty.push(`${lang}.${key}`)
    expect(empty).toEqual([])
  })

  // The checker catches a key missing from a language; it cannot catch one
  // added to a language English does not have, because English is the shape
  // it checks against. That key would be a string nobody can ever read.
  test("no language carries a key english does not", () => {
    const known = new Set<string>(KEYS)
    const extra: string[] = []
    for (const lang of LANGS)
      for (const key of Object.keys(table[lang])) if (!known.has(key)) extra.push(`${lang}.${key}`)
    expect(extra).toEqual([])
  })

  test("a placeholder in one language is a placeholder in all of them", () => {
    const wrong: string[] = []
    for (const key of KEYS) {
      const wanted = t("en", key).includes("{n}")
      for (const lang of LANGS)
        if (t(lang, key).includes("{n}") !== wanted) wrong.push(`${lang}.${key}`)
    }
    expect(wrong).toEqual([])
  })

  // The page interpolates these into markup, and one of the places is an
  // attribute. Nothing needs escaping today; this is what keeps it that way
  // when somebody writes a translation with a quote in it.
  test("no translation carries a character that markup would read", () => {
    const carrying: string[] = []
    for (const lang of LANGS)
      for (const key of KEYS) if (/[<>&"]/.test(t(lang, key))) carrying.push(`${lang}.${key}`)
    expect(carrying).toEqual([])
  })

  test("an unknown language falls back to english, not to a crash", () => {
    expect(langOf("xx")).toBe("en")
    expect(langOf(undefined)).toBe("en")
    expect(langOf("de")).toBe("de")
  })
})

/** Whether the longer string is built on the shorter one's word. */
function shares(whole: string, part: string): boolean {
  return whole.toLocaleLowerCase().includes(part.toLocaleLowerCase())
}

// Three languages had a notice under two names — one in the heading and
// the chip, another in the refusal and the aria label, which are the two
// places a reader meets it when something has gone wrong.
describe("one word for one thing", () => {
  test("the severity of a notice is the word the section uses", () => {
    const wrong = LANGS.filter((lang) => !shares(t(lang, "notices"), t(lang, "sev_info")))
    expect(wrong).toEqual([])
  })

  test("an outage in the banner is an outage in the chip", () => {
    const wrong = LANGS.filter((lang) => !shares(t(lang, "all_down"), t(lang, "sev_outage")))
    expect(wrong).toEqual([])
  })

  test("a duration says where its language puts the word", () => {
    // `after` is a pattern, so a language that drops the placeholder would
    // publish an outage with no duration in it at all.
    const wrong = LANGS.filter((lang) => !t(lang, "after").includes("{t}"))
    expect(wrong).toEqual([])
  })
})
