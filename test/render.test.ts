import { describe, expect, test } from "bun:test"

import { percent, sparkline } from "../src/lib/render.ts"

describe("a percentage the page can stand behind", () => {
  test("four failures in ninety days is not a hundred percent", () => {
    // 99.9969… rounded to two places is 100.00, which is a claim the
    // probes did not make.
    expect(percent(99.99691358024691, "en")).toBe("99.99%")
    expect(percent(99.995, "en")).toBe("99.99%")
  })

  test("each language writes the number the way it writes numbers", () => {
    expect(percent(100, "en")).toBe("100%")
    expect(percent(100, "tr")).toBe("%100")
    // A comma where English puts a point, and the sign where it belongs —
    // held to the number by a non-breaking space, or a phone puts the sign
    // on the line below.
    expect(percent(99.5, "tr")).toBe("%99,50")
    expect(percent(99.5, "de")).toBe("99,50\u00a0%")
    expect(percent(99.5, "de").includes(" ")).toBe(false)
    expect(percent(99.5, "fr")).toBe("99,50\u00a0%")
    expect(percent(99.5, "es")).toBe("99,50\u00a0%")
  })
})

describe("a waveform is a day, not a queue of readings", () => {
  test("an hour with no successful probe is a hole, not a step", () => {
    const day: (number | null)[] = Array.from({ length: 24 }, (_, i) =>
      i < 8 || i > 16 ? 100 : null,
    )
    const svg = sparkline(day, "en")
    // Two runs, so two subpaths: the line does not cross the missing hours.
    expect((svg.match(/M/g) ?? []).length).toBeGreaterThan(2)
  })

  test("a point sits where its hour is, not where its turn is", () => {
    const noon: (number | null)[] = Array.from({ length: 24 }, () => null)
    noon[0] = 10
    noon[23] = 20
    const both = sparkline(noon, "en")
    const half: (number | null)[] = Array.from({ length: 24 }, () => null)
    half[0] = 10
    half[11] = 20
    const early = sparkline(half, "en")
    // The same two readings, an hour apart or half a day apart, cannot
    // draw the same picture.
    expect(both === early).toBe(false)
  })

  test("fewer than two readings is no waveform at all", () => {
    expect(
      sparkline(
        Array.from({ length: 24 }, () => null),
        "en",
      ),
    ).toBe("")
    const one: (number | null)[] = Array.from({ length: 24 }, () => null)
    one[5] = 100
    expect(sparkline(one, "en")).toBe("")
  })
})

describe("a percentage is rounded down, and only down", () => {
  test("a figure binary cannot hold is not rounded down twice", () => {
    // 23 of 125 probes is 18.4 exactly; `18.4 * 100` is 1839.9999999999998.
    expect(percent((100 * 23) / 125, "en")).toBe("18.40%")
    expect(percent((100 * 16560) / 90000, "en")).toBe("18.40%")
  })

  test("and a real shortfall still rounds down", () => {
    expect(percent((100 * 8999) / 9000, "en")).toBe("99.98%")
    expect(percent((100 * 89999) / 90000, "en")).toBe("99.99%")
  })
})
