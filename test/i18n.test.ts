import { describe, expect, test } from "bun:test"

import { KEYS, LANGS, langOf, t, table } from "../src/lib/i18n.ts"

describe("five languages, none of them half-finished", () => {
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

  test("an unknown language falls back to english, not to a crash", () => {
    expect(langOf("xx")).toBe("en")
    expect(langOf(undefined)).toBe("en")
    expect(langOf("de")).toBe("de")
  })
})
