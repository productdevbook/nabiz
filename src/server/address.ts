/** Which hop in a forwarding chain is the client. Everything left of the
 *  nearest trusted proxy is whatever the client typed, so the count of
 *  proxies in front is the only thing that makes the header worth reading:
 *  one proxy means the last entry, two means the one before it. */
export function trustedHops(value: string | undefined): number {
  if (value === undefined || value === "" || value === "0" || value === "false") return 0
  const n = Math.trunc(Number(value))
  return Number.isFinite(n) && n > 0 ? n : 1
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
