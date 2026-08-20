import { describe, expect, test } from "bun:test"

import { authorized } from "../src/lib/api.ts"
import { serviceRow } from "../src/lib/render.ts"
import { insideClient } from "../src/server/paths.ts"

const CLIENT = "/app/dist/client"

describe("what a request may reach inside the built directory", () => {
  test("a file that is there is reached", () => {
    expect(insideClient(CLIENT, "/_astro/index.css")).toBe("/app/dist/client/_astro/index.css")
    expect(insideClient(CLIENT, "/favicon.ico")).toBe("/app/dist/client/favicon.ico")
  })

  // Whatever the spelling, what comes back is inside the built directory —
  // a name in there that does not exist is a 404, and a name outside it is
  // never formed at all.
  test("nothing climbs out, in any spelling", () => {
    const climbs = [
      "/../../etc/passwd",
      "/%2e%2e%2f%2e%2e%2fetc%2fpasswd",
      "/..%2f..%2fschema.sql",
      "/_astro/../../../etc/passwd",
      "/....//....//etc/passwd",
      "/%2e%2e/%2e%2e/schema.sql",
    ]
    const escaped = climbs.filter((url) => {
      const out = insideClient(CLIENT, url)
      return out !== null && !out.startsWith(`${CLIENT}/`)
    })
    expect(escaped).toEqual([])
  })

  test("a climb lands on a name inside, not on the file it aimed at", () => {
    expect(insideClient(CLIENT, "/../../etc/passwd")).toBe("/app/dist/client/etc/passwd")
  })

  test("a path that is not a path at all is refused rather than thrown", () => {
    expect(insideClient(CLIENT, "/%")).toBeNull()
  })
})

const bearer = (token: string) =>
  new Request("https://status.example.com/api/notice", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  })

describe("the token is the only door", () => {
  test("the right one opens it", async () => {
    expect(await authorized(bearer("a-long-enough-secret"), "a-long-enough-secret")).toBe(true)
  })

  test("a wrong one of the same length does not", async () => {
    expect(await authorized(bearer("a-long-enough-secreT"), "a-long-enough-secret")).toBe(false)
  })

  test("neither does a shorter one, a longer one, or none at all", async () => {
    expect(await authorized(bearer("short"), "a-long-enough-secret")).toBe(false)
    expect(await authorized(bearer("a-long-enough-secret-and-more"), "a-long-enough-secret")).toBe(
      false,
    )
    expect(
      await authorized(new Request("https://status.example.com/"), "a-long-enough-secret"),
    ).toBe(false)
  })

  // Without a token configured the door has no lock, so it stays shut.
  test("no token configured refuses everything, including the empty one", async () => {
    expect(await authorized(bearer("anything"), undefined)).toBe(false)
    expect(await authorized(bearer(""), "")).toBe(false)
  })
})

describe("a monitor's name is written by an operator and read by everyone", () => {
  test("it arrives on the page as text, never as markup", () => {
    const html = serviceRow(
      {
        name: '</h3><img src=x onerror=alert(1)>"&',
        ok: true,
        partial: false,
        days: [],
        latency: null,
        spark: null,
      },
      "en",
    )
    expect(html).not.toContain("<img")
    expect(html).toContain("&lt;/h3&gt;&lt;img")
    expect(html).toContain("&quot;&amp;")
  })
})
