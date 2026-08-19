/** Which hop in a forwarding chain is the client. Everything left of the
 *  nearest trusted proxy is whatever the client typed, so the count of
 *  proxies in front is the only thing that makes the header worth reading:
 *  one proxy means the last entry, two means the one before it. */
export function trustedHops(value: string | undefined): number {
  if (value === undefined) return 0
  const said = value.trim().toLowerCase()
  // Only what says a number of proxies, or plainly says yes, counts as
  // one. Anything else is off: a deployment that meant to turn this off
  // and wrote "no" must not end up trusting a header instead.
  if (said === "true" || said === "yes" || said === "on") return 1
  const n = Math.trunc(Number(said))
  return said !== "" && Number.isFinite(n) && n > 0 ? n : 0
}

/** The address the throttle counts by. A chain shorter than the deployment
 *  claims is a chain that lost a proxy, not an invitation to believe the
 *  client: it falls back to the peer, which throttles everyone as one. */
export function clientAddress(
  forwarded: string | undefined,
  peer: string | undefined,
  hops: number,
): string {
  if (hops > 0) {
    const chain = String(forwarded ?? "")
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part !== "")
    const seen = chain[chain.length - hops]
    if (seen !== undefined) return seen
  }
  return peer ?? "?"
}
