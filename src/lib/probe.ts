export interface Monitor {
  id: number
  slug: string
  name: string
  url: string
  method: string
  expect_status: number
  timeout_ms: number
  expect_body: string | null
  fail_threshold: number
  group_name: string | null
  grouped: number
  enabled: number
  position: number
}

/** Why a probe failed, when the status code does not say it. A refused
 *  connection, a name that does not resolve and a handshake that fails are
 *  one word because no runtime tells them apart in a way both of ours
 *  agree on. `incomplete` is the answer that started and stopped. */
export type Reason = "timeout" | "unreachable" | "incomplete" | "body" | null

export interface ProbeResult {
  monitor: Monitor
  ok: boolean
  status: number | null
  ms: number
  reason: Reason
}

/** A probe's own timeout, and the round's if it has one: a monitor with a
 *  generous timeout must not be able to hold the round past the next one.
 *  Both are returned, because which of them fired is the difference
 *  between the host being slow and us being early. */
function within(
  timeout: number,
  deadline?: AbortSignal,
): { own: AbortSignal; signal: AbortSignal } {
  const own = AbortSignal.timeout(timeout)
  if (deadline === undefined) return { own, signal: own }
  const any = (AbortSignal as { any?: (list: AbortSignal[]) => AbortSignal }).any
  return { own, signal: any === undefined ? own : any([own, deadline]) }
}

/** How much of a body is read before the rest is dropped. A page that
 *  answers and then never finishes is down however fast its headers were,
 *  so the body is always read — and an origin that answers with gigabytes
 *  must not be able to take the process down while it proves that. */
const BODY_CAP = 64 * 1024

async function firstOf(response: Response, cap: number): Promise<string> {
  const body = response.body
  if (body === null) return ""
  let seen = 0
  const cut = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      // The chunk is cut rather than taken whole: a runtime that hands
      // over 64 KiB at a time would otherwise make the cap twice what it
      // says, and which runtime it is would decide how much.
      const room = cap - seen
      const kept = chunk.byteLength <= room ? chunk : chunk.subarray(0, room)
      seen += kept.byteLength
      controller.enqueue(kept)
      // Enough to answer the question; the rest is the origin's business.
      if (seen >= cap) controller.terminate()
    },
  })
  return new Response(body.pipeThrough(cut)).text()
}

// Redirects are not followed: a 301 where a 200 was promised is a finding,
// not a detour to take quietly.
export async function probe(monitor: Monitor, deadline?: AbortSignal): Promise<ProbeResult> {
  const started = Date.now()
  const { own, signal } = within(monitor.timeout_ms, deadline)
  // Kept outside the try: an answer that arrived and then stopped is not
  // the same as no answer, and the catch cannot see it otherwise.
  let code: number | null = null
  try {
    const response = await fetch(monitor.url, {
      method: monitor.method,
      redirect: "manual",
      // Without this a cacheable 200 can come from Cloudflare's cache and
      // mask a real outage — a probe must always reach the origin.
      cache: "no-store",
      signal,
      headers: { "user-agent": "nabiz (+https://github.com/productdevbook/nabiz)" },
    })
    const answered = response.status === monitor.expect_status
    code = response.status
    // Time to the answer, not time to the body: reading the body is what
    // catches a host that stops halfway, but charging its size to the
    // latency chart would put a step in every deployment's history at the
    // release that started reading it.
    const ms = Date.now() - started
    // Always read something: a host that sends headers and then stops is a
    // host no browser can load, and reading nothing published it as up
    // with a three-millisecond latency beside it.
    const body = await firstOf(response, BODY_CAP)
    const said = answered && monitor.expect_body ? body.includes(monitor.expect_body) : answered
    return {
      monitor,
      ok: said,
      status: response.status,
      ms,
      // A 200 without the promised words is a failure whose reason is not
      // the status code — saying "HTTP 200" about a red row is the one
      // answer that makes the page look broken instead of the target.
      reason: said ? null : answered ? "body" : null,
    }
  } catch {
    // Our own signal stopped it, or the connection never happened. Both
    // runtimes agree on that much and on nothing finer — except that an
    // answer we had already been given is not "nothing answered".
    //
    // The monitor's timeout is the only clock this page may blame it for.
    // When the round's deadline is what fired, a host that had already
    // answered gets "answered, then stopped" and one that had not gets
    // "timed out" — saying its own timeout elapsed when it did not is
    // telling the reader something untrue about somebody else's server.
    return {
      monitor,
      ok: false,
      status: code,
      ms: Date.now() - started,
      reason: own.aborted
        ? "timeout"
        : code !== null
          ? "incomplete"
          : signal.aborted
            ? "timeout"
            : "unreachable",
    }
  }
}
