import { expect, test } from "bun:test"
// "This repository is public. No real hostnames, tokens, database ids,
// chat ids or webhook addresses anywhere — code, comments, tests, commit
// messages." It is the first rule in CLAUDE.md and until now the only one
// with nothing behind it but attention.
import { execFileSync } from "node:child_process"

import { read, ROOT } from "./source.ts"

function tracked(): string[] {
  return execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .filter((f) => f !== "" && !/\.(png|ico|jpg|webp|woff2?)$/.test(f) && f !== "bun.lock")
}

/** Hosts a public repository may name, and why each is here. */
const ALLOWED = new Set([
  // The documentation's own placeholders.
  "example.com",
  "status.example.com",
  "api.example.com",
  "hooks.example.com",
  "a.example",
  "evil.example",
  "example.test",
  "host",
  "x",
  // Where this project lives, and the badge on its README.
  "github.com",
  "img.shields.io",
  // Standards and credits: an XML namespace and the icon set.
  "www.w3.org",
  "lucide.dev",
  // The one API an alert channel posts to.
  "api.telegram.org",
  // A loopback and a Kubernetes example that names no cluster.
  "127.0.0.1",
  "api.default.svc.cluster.local",
])

test("no host this repository names is somebody's", () => {
  const found: string[] = []
  for (const f of tracked())
    for (const m of read(f).matchAll(/https?:\/\/([a-zA-Z0-9._-]+)/g))
      if (!ALLOWED.has(m[1] as string)) found.push(`${f}: ${m[1] as string}`)
  expect(found).toEqual([])
})

test("nothing here is shaped like a credential", () => {
  const shapes: [string, RegExp][] = [
    // A D1 database id, which names somebody's database.
    ["a database id", /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/],
    ["a telegram bot token", /\bbot\d{6,}:[\w-]{20,}/],
    ["a telegram chat id", /(?<![\d\w])-100\d{9,}/],
    // Actions are pinned to commits on purpose; anywhere else a bare forty
    // hex characters is a secret more often than it is a commit.
    ["a forty-character secret", /\b[0-9a-f]{40}\b/],
  ]
  const found: string[] = []
  for (const f of tracked()) {
    if (f.startsWith(".github/")) continue
    const text = read(f)
    for (const [what, re] of shapes) if (re.test(text)) found.push(`${f}: ${what}`)
  }
  expect(found).toEqual([])
})
