import { describe, expect, test } from "bun:test"

import { percent } from "../src/lib/render.ts"

describe("a percentage the page can stand behind", () => {
  test("four failures in ninety days is not a hundred percent", () => {
    // 99.9969… rounded to two places is 100.00, which is a claim the
    // probes did not make.
    expect(percent(99.99691358024691, "en")).toBe("99.99%")
    expect(percent(99.995, "en")).toBe("99.99%")
  })

  test("a hundred is written without decimals, and in the language's order", () => {
    expect(percent(100, "en")).toBe("100%")
    expect(percent(100, "tr")).toBe("%100")
    expect(percent(99.5, "tr")).toBe("%99.50")
  })
})
