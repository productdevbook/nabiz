import { expect, test } from "bun:test"
// A deployment has to be able to say which build it is: package.json is
// not readable from a bundle, so the number is a constant, and this is
// what keeps the constant honest.
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { VERSION } from "../src/lib/version.ts"
import { ROOT } from "./source.ts"

test("the version the code publishes is the version being released", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { version: string }
  expect(VERSION).toBe(pkg.version)
})
