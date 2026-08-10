export interface Monitor {
  id: number
  slug: string
  name: string
  url: string
  method: string
  expect_status: number
  timeout_ms: number
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
      signal: AbortSignal.timeout(monitor.timeout_ms),
      headers: { "user-agent": "nabiz (+https://github.com/productdevbook/nabiz)" },
    })
    return {
      monitor,
      ok: response.status === monitor.expect_status,
      status: response.status,
      ms: Date.now() - started,
    }
  } catch {
    return { monitor, ok: false, status: null, ms: Date.now() - started }
  }
}
