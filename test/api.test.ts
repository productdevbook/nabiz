import { describe, expect, test } from "bun:test"

import { throttled } from "../src/lib/api"

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
})
