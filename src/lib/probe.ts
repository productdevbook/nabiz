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

export interface ProbeResult {
  monitor: Monitor
  ok: boolean
  status: number | null
  ms: number
}

// Redirects are not followed: a 301 where a 200 was promised is a finding,
// not a detour to take quietly.
export async function probe(monitor: Monitor): Promise<ProbeResult> {
  const started = Date.now()
  try {
    const response = await fetch(monitor.url, {
      method: monitor.method,
      redirect: "manual",
      // Without this a cacheable 200 can come from Cloudflare's cache and
      // mask a real outage — a probe must always reach the origin.
      cache: "no-store",
      signal: AbortSignal.timeout(monitor.timeout_ms),
      headers: { "user-agent": "nabiz (+https://github.com/productdevbook/nabiz)" },
    })
    let ok = response.status === monitor.expect_status
    // Only read the body when the words in it are part of the promise.
    if (ok && monitor.expect_body) ok = (await response.text()).includes(monitor.expect_body)
    return {
      monitor,
      ok,
      status: response.status,
      ms: Date.now() - started,
    }
  } catch {
    return { monitor, ok: false, status: null, ms: Date.now() - started }
  }
}
