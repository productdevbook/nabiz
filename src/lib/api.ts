import type { Db } from "./db.ts"
import type { Lang } from "./i18n.ts"
import { isLang, t } from "./i18n.ts"
import { render } from "./markdown.ts"
import { sevLabel, WINDOW } from "./render.ts"
import type { Overall } from "./shape.ts"
import { eventsView, overall, rows, uptimeOf } from "./shape.ts"
import type { EventRow, Notice, PageData } from "./store.ts"
import { VERSION } from "./version.ts"

// Read-only public data; the same courtesy the page extends, for machines.
const CORS = { "access-control-allow-origin": "*" }

/** What a browser asks before it posts a notice from somewhere else, and
 *  what a scanner asks for free. Answered here rather than by rendering
 *  the whole page, which is what routing it would do. */
export function preflight(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      allow: "GET, HEAD, POST, OPTIONS",
      "access-control-allow-methods": "GET, HEAD, POST, OPTIONS",
      "access-control-allow-headers": "authorization, content-type",
      "access-control-max-age": "86400",
      ...CORS,
    },
  })
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 1), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...CORS,
    },
  })
}

export function statusJson(data: PageData, events: EventRow[]): Response {
  const list = rows(data)
  const state = overall(list)
  const res = json({
    status: state,
    // When a probe last wrote, not when this rendered: a page whose loop
    // has stopped must not keep saying it was updated a second ago.
    updated_at: data.wrote === null ? null : new Date(data.wrote).toISOString(),
    monitors: list.map((r) => {
      const m: Record<string, unknown> = {
        name: r.name,
        status: r.ok === null ? "unknown" : r.ok ? "up" : r.partial ? "degraded" : "down",
        uptime_90d: uptimeOf(r.days),
      }
      if (r.latency !== null) m.latency_ms = r.latency
      // What the last probe answered, when it was not what was promised.
      // Absent rather than null when there is nothing to say — a group
      // publishes no member's answer, and saying "nothing answered" about
      // hosts that answered is a different claim from saying nothing.
      if (r.ok === false && r.code !== undefined) {
        m.last_status = r.code
        // Why, when the code does not say it — and only the words this
        // document promises: the column is written by one function today,
        // and an API that publishes an enum should not publish whatever it
        // finds in a row.
        if (r.reason !== null && r.reason !== undefined && REASONS.has(r.reason))
          m.reason = r.reason
      }
      return m
    }),
    recent_events: eventsView(data.monitors, events, data.states, 20).map((e) => ({
      monitor: e.label,
      at: new Date(e.at).toISOString(),
      status: e.ok ? "up" : "down",
    })),
  })
  res.headers.set("x-status", state)
  return res
}

export function historyJson(data: PageData): Response {
  const list = rows(data)
  return json({
    window_days: WINDOW,
    monitors: list.map((r) => ({
      name: r.name,
      days: r.days.map((d) => ({
        day: d.day,
        checks: d.total,
        ok: d.ok,
        avg_ms: d.total === 0 ? null : Math.round(d.ms_sum / d.total),
      })),
    })),
  })
}

const COLORS: Record<Overall, string> = {
  up: "#22a06b",
  sites: "#e8a13c",
  degraded: "#e8a13c",
  down: "#d64545",
}

/** A shields-style badge for a readme: label "status", value the overall.
 *  English whatever the page speaks, and deliberately so — it lives in a
 *  readme beside build and coverage badges, which are English too. */
export function badge(data: PageData): Response {
  const state = overall(rows(data))
  const color = COLORS[state]
  const label = "status"
  const lw = 6 * label.length + 12
  const vw = 6.2 * state.length + 14
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${lw + vw}" height="20" role="img" aria-label="${label}: ${state}">
<rect width="${lw}" height="20" rx="3" fill="#555"/>
<rect x="${lw - 3}" width="${vw + 3}" height="20" fill="${color}"/>
<rect x="${lw - 3}" width="3" height="20" fill="#555"/>
<rect x="${lw + vw - 3}" width="3" height="20" rx="3" fill="${color}"/>
<g fill="#fff" font-family="Verdana,DejaVu Sans,sans-serif" font-size="11" text-anchor="middle">
<text x="${lw / 2}" y="14">${label}</text>
<text x="${lw + vw / 2}" y="14">${state}</text>
</g>
</svg>`
  return new Response(svg, {
    headers: { "content-type": "image/svg+xml", "cache-control": "no-store", ...CORS },
  })
}

/** XML 1.0 carries tab, newline and carriage return and no other control
 *  character, and a lone surrogate is not a character at all. One of either,
 *  pasted into a notice or a monitor's name, costs a subscriber the whole
 *  feed rather than the one item — so they are dropped rather than escaped. */
function escXml(s: string): string {
  let out = ""
  for (const ch of s) {
    const code = ch.codePointAt(0) as number
    if (code < 0x20 && code !== 9 && code !== 10 && code !== 13) continue
    if (code >= 0xd800 && code <= 0xdfff) continue
    out += ch === "&" ? "&amp;" : ch === "<" ? "&lt;" : ch === ">" ? "&gt;" : ch
  }
  return out
}

/** A notice's first line without the marks that make it markdown: the
 *  body renders, a title does not. */
function plain(body: string): string {
  return (
    (body.split("\n")[0] ?? "")
      .replace(/`([^`]{0,1000})`/g, "$1")
      .replace(/\*\*([^*]*)\*\*/g, "$1")
      .replace(/\*([^*]*)\*/g, "$1")
      // Bounded for the reason src/lib/markdown.ts is: an unbounded run to
      // the closing bracket is quadratic in a body full of opening ones.
      .replace(/\[([^\]]{0,400})\]\([^)]{0,2000}\)/g, "$1")
      .replace(/^#+\s*/, "")
      .trim()
  )
}

/** State changes as RSS — the subscription a paid status product sells,
 *  from any feed reader, for nothing. */
export function feed(
  origin: string,
  title: string,
  data: PageData,
  events: EventRow[],
  noticeList: Notice[],
  lang: Lang,
): Response {
  // The origin comes from the Host header, which nobody has checked.
  const here = escXml(origin)
  const entries: { at: number; xml: string }[] = []
  for (const e of eventsView(data.monitors, events, data.states, 50)) {
    const what = e.ok ? t(lang, "recovered") : t(lang, "down")
    entries.push({
      at: e.at,
      xml: `<item><title>${escXml(e.label)} — ${what}</title><description>${escXml(`${e.label} — ${what}`)}</description><pubDate>${new Date(e.at).toUTCString()}</pubDate><guid isPermaLink="false">${e.at}-${escXml(e.label)}</guid><link>${here}/</link></item>`,
    })
  }
  // What the operator wrote belongs in the same stream as what the probes
  // saw — a subscriber wants the story, not one half of it.
  for (const n of noticeList) {
    entries.push({
      at: n.at,
      xml: `<item><title>[${escXml(sevLabel(n.severity, lang))}] ${escXml(plain(n.body_md).slice(0, 100))}</title><description>${escXml(render(n.body_md))}</description><pubDate>${new Date(n.at).toUTCString()}</pubDate><guid isPermaLink="false">notice-${n.id}</guid><link>${here}/</link></item>`,
    })
  }
  const items = entries
    .toSorted((a, b) => b.at - a.at)
    .map((e) => e.xml)
    .join("\n")
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>${escXml(title)}</title>
<link>${here}/</link>
<description>${escXml(title)}</description>
${items}
</channel></rss>`
  return new Response(xml, {
    headers: {
      "content-type": "application/rss+xml; charset=utf-8",
      "cache-control": "no-store",
      ...CORS,
    },
  })
}

/** What an agent needs to know, at the address agents look — in the shape
 *  llmstxt.org asks for: a heading, a summary it can read first, and lists
 *  whose entries are links rather than sentences about links. */
export function llms(origin: string, title: string): Response {
  const text = `# ${title}

> A status page run by nabiz ${VERSION}
> (https://github.com/productdevbook/nabiz). The
> services listed on it are probed once a minute and ninety days of history
> are kept. Everything here is public, read-only and CORS-open. Every
> answer here is held briefly — at most fifteen seconds on Cloudflare, and
> until the next probe round on a self-hosted one — and every round drops
> what it held, so nothing served is older than the round behind it.

A monitor marked as a group stands for several hosts that are served here
but named elsewhere; neither their names nor their number is published.

## Endpoints

- [The page](${origin}/): HTML, and the JSON below to an Accept header that asks for it
- [status.json](${origin}/api/status.json): current state, per-monitor uptime and latency, why anything is down, recent events
- [history.json](${origin}/api/history.json): ninety days of daily totals per monitor
- [notices.json](${origin}/api/notices.json): operator-written notices, markdown and rendered
- [badge.svg](${origin}/badge.svg): the overall state as a badge
- [feed.xml](${origin}/feed.xml): state changes and notices as RSS
- [health](${origin}/health): 204 when the status page itself is alive, with no database behind it, and an "x-nabiz" header carrying the build
- [robots.txt](${origin}/robots.txt): crawling is welcome; it points here

## Asking cheaply

HEAD ${origin}/ answers with an "x-status" response header that says up,
sites, degraded or down, and no body. ${origin}/api/status.json carries
the same header; no other endpoint does.

GET ${origin}/ with "Accept: application/json" (and no text/html) returns
the status.json body instead of HTML. A Link header on the HTML page
points to this file, the JSON and the RSS feed, and the HTML head carries
the same links as <link rel="alternate">.

The page, the feed and notices.json take ?lang= (en, tr, de, es, fr).
The page and the feed translate their words and serve a notice written
for one language only to that language; notices.json does the same when
asked for a language, and returns every notice when not. The other
endpoints carry no words to translate.

## Reading status.json

"status" is one of four for the whole page: "up", "sites" when only some
of the hosted sites are unreachable and everything else is serving,
"degraded" when a service is down, and "down" when nothing answers.

Each monitor carries "status" — "up", "down", or "unknown" before its
first probe has written anything, and "degraded" only for a group —
"uptime_90d" (percent, null before the first day of data), and
"latency_ms" from the most recent successful probe.

A monitor that is down also carries "last_status", the code its last probe
was answered with, and "reason" when the code does not say it: "timeout",
"unreachable" for a connection that never happened, or "body" for a
promised status with the wrong words in it. A group carries neither: it
speaks for several hosts and publishes none of their answers. A grouped monitor speaks for several hosts and says only
how it is: "degraded" while some of them are unreachable, "down" once half
or more are. How many there are is not published — that number is a
customer count. Its uptime and its days are the median member's rather
than a total, so one host's outage is not billed to the others.

## Writing

For the operator, with a token. POST ${origin}/api/notice with
Authorization: Bearer <token> and a JSON body of {"body": "markdown",
"severity": "info|maintenance|degraded|outage", "lang":
"all|en|tr|de|es|fr"}; POST ${origin}/api/notice/resolve with the same
header and {"id": n}.

Ten guesses at the token a minute per address, counted in the memory of
whichever process answered — so on Cloudflare, where there are many, it is
a brake rather than a limit. A refusal carries retry-after.

## Optional

- [robots.txt](${origin}/robots.txt): everyone is allowed; there is nothing here worth hiding
`
  return new Response(text, {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", ...CORS },
  })
}

/** `null` is what JSON.parse makes of "null", and a body that is not an
 *  object has no fields to read — both are the same bad request. */
/** The two answers a write can be refused with. They are CORS-open like
 *  every other answer here: a refusal a cross-origin operator page cannot
 *  read is the one it most needs. */
export function refused(what: "throttled" | "unauthorized"): Response {
  if (what === "throttled") {
    const answer = json({ error: "too many attempts" }, 429)
    answer.headers.set("retry-after", "60")
    return answer
  }
  return json({ error: "unauthorized" }, 401)
}

async function jsonBody<T>(request: Request): Promise<T | null> {
  try {
    const parsed: unknown = await request.json()
    return typeof parsed === "object" && parsed !== null ? (parsed as T) : null
  } catch {
    return null
  }
}

const REASONS: ReadonlySet<string> = new Set(["timeout", "unreachable", "incomplete", "body"])

const SEVERITIES = new Set(["info", "maintenance", "degraded", "outage"])

/** Per-isolate brake on token guessing: ten tries a minute per address.
 *  An isolate's memory is not global state, but a brute force rides one
 *  connection into one colo — and that path this closes. */
const attempts = new Map<string, { n: number; until: number }>()

/** A token that turned out to be right was never a guess. Without this the
 *  operator writing a run of updates during an incident is cut off at the
 *  tenth, which is exactly when the page is worth writing on. */
export function forgive(request: Request): void {
  attempts.delete(request.headers.get("cf-connecting-ip") ?? "?")
}

/** How many addresses are remembered at once. A worker isolate is short
 *  enough to forget by itself; a server that runs for months is not, and a
 *  flood of addresses must cost memory that stops somewhere. */
const REMEMBERED = 10_000

export function throttled(request: Request, now = Date.now()): boolean {
  if (attempts.size >= REMEMBERED) {
    for (const [k, v] of attempts) if (v.until < now) attempts.delete(k)
    // Still full, so every slot is live: the ones closest to expiring go
    // first, because they were about to anyway. A flood can buy itself a
    // fresh count this way, which is the cost of not growing forever.
    if (attempts.size >= REMEMBERED) {
      const soonest = [...attempts.entries()]
        .toSorted((a, b) => a[1].until - b[1].until)
        .slice(0, REMEMBERED / 2)
      for (const [k] of soonest) attempts.delete(k)
    }
  }
  const ip = request.headers.get("cf-connecting-ip") ?? "?"
  const slot = attempts.get(ip)
  if (slot === undefined || slot.until < now) {
    attempts.set(ip, { n: 1, until: now + 60_000 })
    return false
  }
  slot.n += 1
  return slot.n > 10
}

/** The operator's word is a write, and writes need the token — compared in
 *  constant time, because a status page is still a door. Workers offer the
 *  comparison; off the edge it is the loop below, which is the same promise. */
export async function authorized(request: Request, token: string | undefined): Promise<boolean> {
  if (!token) return false
  const given = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? ""
  const enc = new TextEncoder()
  const a = enc.encode(given)
  const b = enc.encode(token)
  if (a.byteLength !== b.byteLength) return false

  const subtle = crypto.subtle as {
    timingSafeEqual?: (x: ArrayBufferView, y: ArrayBufferView) => boolean
  }
  if (subtle.timingSafeEqual !== undefined) return subtle.timingSafeEqual(a, b)
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= (a[i] as number) ^ (b[i] as number)
  return diff === 0
}

export async function postNotice(request: Request, db: Db): Promise<Response> {
  const body = await jsonBody<{ severity?: unknown; body?: unknown }>(request)
  if (body === null) return json({ error: "the body was not a json object" }, 400)
  // Absent is `info`; present and not a string is a mistake worth saying
  // out loud. A client that sends ["outage"] during an outage published it
  // as an info notice and was answered 201.
  if (body.severity !== undefined && typeof body.severity !== "string")
    return json({ error: "severity must be a string" }, 400)
  const severity = body.severity ?? "info"
  const text = typeof body.body === "string" ? body.body.trim() : ""
  const langRaw = (body as { lang?: unknown }).lang
  const lang =
    langRaw === undefined || langRaw === null || langRaw === "all"
      ? null
      : typeof langRaw === "string" && isLang(langRaw)
        ? langRaw
        : false
  if (lang === false) return json({ error: "unknown lang" }, 400)
  if (!SEVERITIES.has(severity)) return json({ error: "unknown severity" }, 400)
  if (text.length === 0 || text.length > 4000)
    return json({ error: "the notice must be 1 to 4000 characters" }, 400)

  const { addNotice } = await import("./store.ts")
  const id = await addNotice(db, severity, text, lang)
  return json({ id }, 201)
}

export async function postResolve(request: Request, db: Db): Promise<Response> {
  const body = await jsonBody<{ id?: unknown }>(request)
  if (body === null) return json({ error: "the body was not a json object" }, 400)
  if (typeof body.id !== "number" || !Number.isSafeInteger(body.id))
    return json({ error: "id must be a whole number" }, 400)
  const { resolveNotice } = await import("./store.ts")
  const done = await resolveNotice(db, body.id)
  return done ? json({ resolved: body.id }) : json({ error: "no open notice with that id" }, 404)
}

export function noticesJson(list: Notice[]): Response {
  return json({
    notices: list.map((n) => ({
      id: n.id,
      at: new Date(n.at).toISOString(),
      severity: n.severity,
      lang: n.lang,
      body_md: n.body_md,
      body_html: render(n.body_md),
      resolved_at: n.resolved_at === null ? null : new Date(n.resolved_at).toISOString(),
    })),
  })
}
