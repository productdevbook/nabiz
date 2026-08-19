import { describe, expect, test } from "bun:test"

import { clientAddress, trustedHops } from "../src/server/address.ts"

describe("the address a throttle may count by", () => {
  test("with no proxy in front the header is not read at all", () => {
    expect(clientAddress("1.2.3.4", "10.0.0.9", 0)).toBe("10.0.0.9")
  })

  test("one proxy means the entry that proxy saw, not the one it was told", () => {
    // The client typed the first entry; the proxy appended what it saw.
    expect(clientAddress("9.9.9.9, 203.0.113.7", "10.0.0.9", 1)).toBe("203.0.113.7")
  })

  test("two proxies count two hops back", () => {
    expect(clientAddress("9.9.9.9, 203.0.113.7, 10.0.0.2", "10.0.0.9", 2)).toBe("203.0.113.7")
  })

  test("a chain shorter than claimed falls back to the peer", () => {
    expect(clientAddress("", "10.0.0.9", 1)).toBe("10.0.0.9")
    expect(clientAddress("203.0.113.7", "10.0.0.9", 2)).toBe("10.0.0.9")
    expect(clientAddress(undefined, undefined, 1)).toBe("?")
  })

  test("the count is read the way a deployment would write it", () => {
    expect(trustedHops(undefined)).toBe(0)
    expect(trustedHops("")).toBe(0)
    expect(trustedHops("0")).toBe(0)
    expect(trustedHops("false")).toBe(0)
    expect(trustedHops("1")).toBe(1)
    expect(trustedHops("2")).toBe(2)
    // Anything else truthy is one proxy, which is the common shape.
    expect(trustedHops("true")).toBe(1)
    expect(trustedHops("yes")).toBe(1)
    expect(trustedHops("-3")).toBe(1)
  })
})
