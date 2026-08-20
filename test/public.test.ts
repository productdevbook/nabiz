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
  // Not hosts at all: Kubernetes API groups and label prefixes, which are
  // spelled like domains and resolve to nothing.
  "app.kubernetes.io",
  "networking.k8s.io",
  "kustomize.config.k8s.io",
])

test("no host this repository names is somebody's", () => {
  const found: string[] = []
  for (const f of tracked())
    for (const m of read(f).matchAll(/https?:\/\/([a-zA-Z0-9._-]+)/g))
      if (!ALLOWED.has(m[1] as string)) found.push(`${f}: ${m[1] as string}`)
  expect(found).toEqual([])
})

test("no host is named without a scheme either", () => {
  // The scheme rule reads what follows `http(s)://`, and a hostname in a
  // table, a comment or a compose file has no scheme in front of it.
  const wrong: string[] = []
  for (const f of tracked()) {
    // A stylesheet has no hostnames outside a url(), which the rule above
    // reads; what it does have is chains of class selectors, and one of
    // them ends in a word this pattern would take for a top-level domain.
    if (f.endsWith(".css")) continue
    for (const m of read(f).matchAll(
      /\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)+\.(?:com|net|org|io|dev|co|uk|de|tr|app|cloud|sh|me|xyz|info|biz|local)\b/g,
    ))
      if (!ALLOWED.has(m[0])) wrong.push(`${f}: ${m[0]}`)
  }
  expect(wrong).toEqual([])
})

test("nothing here is shaped like a credential", () => {
  const shapes: [string, RegExp][] = [
    // A D1 database id, which names somebody's database.
    ["a database id", /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/],
    // With or without the `bot` prefix the API asks for: a token is stored
    // as the digits, a colon and the secret.
    ["a telegram bot token", /\b\d{6,12}:[\w-]{25,}/],
    ["a telegram chat id", /(?<![\d\w])-100\d{9,}/],
    // Actions are pinned to commits on purpose; anywhere else a bare forty
    // hex characters is a secret more often than it is a commit.
    ["a forty-character secret", /\b[0-9a-f]{40}\b/],
  ]
  const found: string[] = []
  for (const f of tracked()) {
    const text = read(f)
    for (const [what, re] of shapes) {
      // Actions are pinned to commits on purpose, and only there.
      if (what.includes("forty-character") && f.startsWith(".github/")) continue
      if (re.test(text)) found.push(`${f}: ${what}`)
    }
  }
  expect(found).toEqual([])
})
