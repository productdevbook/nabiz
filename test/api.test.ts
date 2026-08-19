import { describe, expect, test } from "bun:test"

import { forgive, postNotice, throttled } from "../src/lib/api.ts"
import type { Db } from "../src/lib/db.ts"

const from = (ip: string) =>
  new Request("https://status.example.com/api/notice", {
    method: "POST",
    headers: { "cf-connecting-ip": ip },
  })

describe("the brake on token guessing", () => {
  test("ten tries pass, the eleventh does not", () => {
    for (let i = 0; i < 10; i++) expect(throttled(from("192.0.2.1"))).toBe(false)
    expect(throttled(from("192.0.2.1"))).toBe(true)
  })

  test("another address is not punished for the first one's sins", () => {
    for (let i = 0; i < 11; i++) throttled(from("192.0.2.2"))
    expect(throttled(from("192.0.2.3"))).toBe(false)
  })

  test("the window closes and the counter forgets", () => {
    for (let i = 0; i < 11; i++) throttled(from("192.0.2.4"))
    expect(throttled(from("192.0.2.4"), Date.now() + 61_000)).toBe(false)
  })

  // The operator writing a run of updates during an incident is not a
  // brute force, and the tenth notice is not the one to refuse.
  test("a request that turned out to be authorized is not a guess", () => {
    for (let i = 0; i < 9; i++) throttled(from("192.0.2.5"))
    forgive(from("192.0.2.5"))
    for (let i = 0; i < 10; i++) expect(throttled(from("192.0.2.5"))).toBe(false)
  })
})

const nowhere = {
  prepare: () => {
    throw new Error("the body was refused before it reached the database")
  },
  batch: async () => [],
} as unknown as Db

const body = (raw: string) =>
  new Request("https://status.example.com/api/notice", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: raw,
  })

describe("a body that is not an object is a bad request", () => {
  test("null, a string and a list are all refused with 400", async () => {
    const answers = await Promise.all(
      ["null", '"a notice"', "[1, 2]", "{"].map((raw) => postNotice(body(raw), nowhere)),
    )
    expect(answers.map((r) => r.status)).toEqual([400, 400, 400, 400])
  })
})
