import type { Lang } from "./i18n"
import { isLang, t } from "./i18n"
import { render } from "./markdown"
import type { Overall } from "./shape"
import { eventsView, overall, rows, uptimeOf } from "./shape"
import type { EventRow, Notice, PageData } from "./store"

// Read-only public data; the same courtesy the page extends, for machines.
const CORS = { "access-control-allow-origin": "*" }

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
    updated_at: new Date().toISOString(),
    monitors: list.map((r) => {
      const m: Record<string, unknown> = {
        name: r.name,
        status: r.ok === null ? "unknown" : r.ok ? "up" : "down",
        uptime_90d: uptimeOf(r.days),
      }
      if (r.tally !== null) m.up = r.tally
      if (r.latency !== null) m.latency_ms = r.latency
      return m
    }),
    recent_events: eventsView(data.monitors, events).map((e) => ({
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
    window_days: 90,
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

const COLORS: Record<Overall, string> = { up: "#22a06b", degraded: "#e8a13c", down: "#d64545" }

/** A shields-style badge for a readme: label "status", value the overall. */
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

function escXml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] as string)
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
  const entries: { at: number; xml: string }[] = []
  for (const e of eventsView(data.monitors, events)) {
    const what = e.ok ? t(lang, "recovered") : t(lang, "down")
    entries.push({
      at: e.at,
      xml: `<item><title>${escXml(e.label)} — ${what}</title><pubDate>${new Date(e.at).toUTCString()}</pubDate><guid isPermaLink="false">${e.at}-${escXml(e.label)}</guid><link>${origin}/</link></item>`,
    })
  }
  // What the operator wrote belongs in the same stream as what the probes
  // saw — a subscriber wants the story, not one half of it.
  for (const n of noticeList) {
    entries.push({
      at: n.at,
      xml: `<item><title>[${escXml(n.severity)}] ${escXml(n.body_md.split("\n")[0] ?? "").slice(0, 100)}</title><description>${escXml(render(n.body_md))}</description><pubDate>${new Date(n.at).toUTCString()}</pubDate><guid isPermaLink="false">notice-${n.id}</guid><link>${origin}/</link></item>`,
    })
  }
  const items = entries
    .toSorted((a, b) => b.at - a.at)
    .map((e) => e.xml)
    .join("\n")
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>${escXml(title)}</title>
<link>${origin}/</link>
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

/** What an agent needs to know, at the address agents look. */
export function llms(origin: string, title: string): Response {
  const text = `# ${title}

This is a status page, run by nabiz (https://github.com/productdevbook/nabiz).
It probes the services listed on it every minute and keeps ninety days of
history. Monitors marked as a group ("N/M up") stand for hosts that are
served here but named elsewhere; they are counted, never listed.

## Endpoints

- ${origin}/                 the page, HTML
- ${origin}/api/status.json  current state, per-monitor uptime and latency, recent events
- ${origin}/api/history.json ninety days of daily totals per monitor
- ${origin}/badge.svg        the overall state as a badge
- ${origin}/feed.xml         state changes and notices as RSS
- ${origin}/api/notices.json operator-written notices, markdown and rendered
- ${origin}/health           204 when the status page itself is alive

Every read endpoint takes ?lang= (en, tr, de, es, fr): the page and the
feed translate their words, and notices written for one language are
served only to it — a notice with no language speaks to everyone.

## For machines

The page answers to the shape of the request, so the cheapest question
works:

- HEAD ${origin}/ — the "x-status" response header says up, degraded or
  down; no body needed. ${origin}/api/status.json carries it too.
- GET ${origin}/ with "Accept: application/json" (and no text/html)
  returns the status.json body instead of HTML.
- A Link header on / points to this file, the JSON and the RSS feed;
  the HTML head carries the same links as <link rel="alternate">.
- robots.txt allows everyone; there is nothing here worth hiding.

All JSON is read-only, CORS-open, and uncached: what you get is what is
true at the moment you asked. Writing exists too, for the operator:
POST /api/notice with Authorization: Bearer <token> and a JSON body of
{"body": "markdown", "severity": "info|maintenance|degraded|outage",
"lang": "all|en|tr|de|es|fr"}; POST /api/notice/resolve with {"id": n}.

## Reading status.json

"status" is "up", "degraded" or "down" for the whole page. Each monitor
carries "status", "uptime_90d" (percent, null before the first day of
data), and "latency_ms" from the most recent successful probe. Grouped
monitors carry "up" as a tally like "5/6" instead of a latency.
`
  return new Response(text, {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", ...CORS },
  })
}

const SEVERITIES = new Set(["info", "maintenance", "degraded", "outage"])

/** The operator's word is a write, and writes need the token — compared in
 *  constant time, because a status page is still a door. */
export async function authorized(request: Request, token: string | undefined): Promise<boolean> {
  if (!token) return false
  const given = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? ""
  const enc = new TextEncoder()
  const a = enc.encode(given)
  const b = enc.encode(token)
  if (a.byteLength !== b.byteLength) return false
  return crypto.subtle.timingSafeEqual(a, b)
}

export async function postNotice(request: Request, db: D1Database): Promise<Response> {
  let body: { severity?: unknown; body?: unknown }
  try {
    body = await request.json()
  } catch {
    return json({ error: "the body was not json" }, 400)
  }
  const severity = typeof body.severity === "string" ? body.severity : "info"
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

  const { addNotice } = await import("./store")
  const id = await addNotice(db, severity, text, lang)
  return json({ id }, 201)
}

export async function postResolve(request: Request, db: D1Database): Promise<Response> {
  let body: { id?: unknown }
  try {
    body = await request.json()
  } catch {
    return json({ error: "the body was not json" }, 400)
  }
  if (typeof body.id !== "number") return json({ error: "id must be a number" }, 400)
  const { resolveNotice } = await import("./store")
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
