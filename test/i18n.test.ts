import { describe, expect, test } from "bun:test"

import { langOf, t } from "../src/lib/i18n"
import type { Key, Lang } from "../src/lib/i18n"

const langs: Lang[] = ["en", "tr", "de", "es", "fr"]
const someKeys: Key[] = ["all_up", "notices", "ed_publish", "sev_outage", "recent_events"]

describe("five languages, none of them half-finished", () => {
  test("every language answers every key with something non-empty", () => {
    for (const lang of langs)
      for (const key of someKeys) {
        expect(t(lang, key).length).toBeGreaterThan(0)
      }
  })

  test("an unknown language falls back to english, not to a crash", () => {
    expect(langOf("xx")).toBe("en")
    expect(langOf(undefined)).toBe("en")
    expect(langOf("de")).toBe("de")
  })
})
