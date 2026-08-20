// The page's HTML fragments — everything data-shaped, kept out of the
// component so it stays testable and the component stays readable.
import type { Lang } from "./i18n.ts"
import { t } from "./i18n.ts"
import { render } from "./markdown.ts"
import type { Row } from "./shape.ts"
import { uptimeOf } from "./shape.ts"
import type { DayRow, Notice } from "./store.ts"

export const WINDOW = 90

export function esc(s: string): string {
  return s.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string,
  )
}

// Turkish writes %50 and English 50%; the four others put a comma where
// English puts a point, and three of them a space before the sign.
// Rounded down, not to nearest: 99.997% is not a hundred, and a status
// page that says it is has rounded away the only failure of the quarter.
export function percent(pct: number, lang: Lang): string {
  // Rounded down, deliberately: four failed probes in ninety days must not
  // print as a hundred percent. The nudge is because binary cannot hold
  // 18.4 — `18.4 * 100` is 1839.9999999999998, and flooring that dropped a
  // hundredth the rule never meant to drop.
  const plain = pct === 100 ? "100" : (Math.floor(pct * 100 + 1e-9) / 100).toFixed(2)
  // A point and no space in English and Chinese; a comma in the rest, and
  // the sign in front of it in Turkish.
  const n = lang === "en" || lang === "zh-CN" ? plain : plain.replace(".", ",")
  if (lang === "tr") return `%${n}`
  if (lang === "zh-CN") return `${n}%`
  // A non-breaking space: the four languages that put one before the sign
  // were dropping the sign onto its own line on a phone.
  return lang === "en" ? `${n}%` : `${n}\u00a0%`
}

export function when(at: number): string {
  return new Date(at).toISOString().replace("T", " ").slice(0, 16) + " UTC"
}

/** Ninety days as ninety marks. A reader is not given them one by one —
 *  the strip is hidden from the accessibility tree, and the same ninety
 *  days are already spoken in the figure beside it. */
export function bars(days: DayRow[], lang: Lang): string {
  const byDay = new Map(days.map((d) => [d.day, d]))
  const cells: string[] = []
  for (let i = WINDOW - 1; i >= 0; i--) {
    const day = new Date(Date.now() - i * 24 * 3600 * 1000).toISOString().slice(0, 10)
    const d = byDay.get(day)
    if (d === undefined || d.total === 0) {
      cells.push(`<i title="${day} · ${esc(t(lang, "no_data"))}"></i>`)
      continue
    }
    const pct = (100 * d.ok) / d.total
    const cls = pct >= 99.9 ? "ok" : pct >= 95 ? "meh" : "bad"
    cells.push(`<i class="${cls}" title="${day} · ${percent(pct, lang)}"></i>`)
  }
  return cells.join("")
}

export function uptimeLabel(days: DayRow[], lang: Lang): string | null {
  const pct = uptimeOf(days)
  return pct === null ? null : percent(pct, lang)
}

/** A day of latency as a hairline: a number says how it is, a line says how
 *  it has been. Area fill under the line, a dot on the newest point. */
/** A run of points as one path. */
function path(xy: readonly (readonly [number, number])[]): string {
  return xy.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ")
}

/** One slot per hour, in place. A slot with nothing in it is an hour with
 *  no successful probe, and the line breaks there rather than stepping to
 *  the next hour that has one — a day with an afternoon missing is not a
 *  day of continuous latency. */
export function sparkline(points: (number | null)[], lang: Lang): string {
  const seen = points.filter((p): p is number => p !== null)
  if (seen.length < 2) return ""
  const w = 72
  const h = 16
  const max = Math.max(...seen)
  const min = Math.min(...seen)
  const span = Math.max(max - min, 1)
  const at = (p: number, i: number) =>
    [
      ((w - 4) * i) / Math.max(points.length - 1, 1) + 2,
      h - 2.5 - ((h - 6) * (p - min)) / span,
    ] as const

  const runs: (readonly [number, number])[][] = []
  let run: (readonly [number, number])[] = []
  points.forEach((p, i) => {
    if (p === null) {
      if (run.length > 0) runs.push(run)
      run = []
      return
    }
    run.push(at(p, i))
  })
  if (run.length > 0) runs.push(run)

  const line = runs.map(path).join(" ")
  const area = runs
    .filter((xy) => xy.length > 1)
    .map((xy) => {
      const [sx] = xy[0] as readonly [number, number]
      const [ex] = xy[xy.length - 1] as readonly [number, number]
      return `${path(xy)} L${ex.toFixed(1)} ${h - 1} L${sx.toFixed(1)} ${h - 1} Z`
    })
    .join(" ")
  const last = (runs[runs.length - 1] ?? []) as readonly (readonly [number, number])[]
  const [ex, ey] = last[last.length - 1] as readonly [number, number]
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><title>${t(lang, "last_day")}</title><path d="${area}" fill="currentColor" opacity="0.12" stroke="none"/><path d="${line}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${ex.toFixed(1)}" cy="${ey.toFixed(1)}" r="1.8" fill="currentColor"/></svg>`
}

export function sevLabel(severity: string, lang: Lang): string {
  const key =
    severity === "maintenance"
      ? "sev_maintenance"
      : severity === "degraded"
        ? "sev_degraded"
        : severity === "outage"
          ? "sev_outage"
          : "sev_info"
  return t(lang, key)
}

/** An open notice: the operator's voice, above everything else. */
export function callout(n: Notice, lang: Lang): string {
  return `<article class="callout ${esc(n.severity)}" data-notice="${n.id}" data-open="1">
  <header><span class="chip ${esc(n.severity)}">${sevLabel(n.severity, lang)}</span><time>${when(n.at)}</time></header>
  <div class="md">${render(n.body_md)}</div>
</article>`
}

/** A resolved notice: still part of the story, no longer part of the noise. */
export function pastNotice(n: Notice, lang: Lang): string {
  return `<article class="past">
  <header><span class="chip done">${t(lang, "resolved")}</span><time>${when(n.at)}</time></header>
  <div class="md">${render(n.body_md)}</div>
</article>`
}

/** The row's star is the uptime figure; latency is a whispered aside. */
export function serviceRow(r: Row, lang: Lang): string {
  // Amber, not red: a group with some members up is trouble, not an outage.
  const dot = r.ok === null ? "none" : r.ok ? "ok" : r.partial ? "meh" : "bad"
  const word =
    r.ok === null ? "—" : r.ok ? t(lang, "up") : r.partial ? t(lang, "partly") : t(lang, "down")
  const tele =
    r.latency !== null
      ? `<span class="tele ${dot}">${r.spark ? sparkline(r.spark, lang) : ""}<span class="ms">${r.latency} ms</span></span>`
      : ""
  const pct = uptimeLabel(r.days, lang)
  const figure =
    pct === null ? `<span class="pct none">—</span>` : `<span class="pct">${pct}</span>`
  // A failure that is a redirect, a timeout, a refused connection or a
  // promised page with the wrong words in it are four different problems
  // and one red pill; the answer goes where the word is, and to a reader
  // who cannot hover. A group has no answer of its own to give.
  const said =
    r.ok !== false || r.code === undefined
      ? null
      : r.reason === "timeout" ||
          r.reason === "unreachable" ||
          r.reason === "incomplete" ||
          r.reason === "body"
        ? t(lang, `why_${r.reason}`)
        : r.code === null
          ? t(lang, "no_answer")
          : `HTTP ${r.code}`
  const why = said === null ? "" : ` title="${esc(said)}" aria-label="${esc(`${word} — ${said}`)}"`
  return `<section class="svc">
  <header>
    <div class="who"><h3>${esc(r.name)}</h3><span class="state ${dot}"${why}>${word}</span>${tele}</div>
    ${figure}
  </header>
  <div class="bars" aria-hidden="true">${bars(r.days, lang)}</div>
  <footer><span>${t(lang, "window_ago").replace("{n}", String(WINDOW))}</span><span>${t(lang, "today")}</span></footer>
</section>`
}

const ARROW_UP = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 7h10v10"/><path d="M7 17 17 7"/></svg>`
const ARROW_DOWN = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m7 7 10 10"/><path d="M17 7v10H7"/></svg>`

export function eventLine(e: { label: string; at: number; ok: boolean }, lang: Lang): string {
  return `<li><span class="dot ${e.ok ? "ok" : "bad"}">${e.ok ? ARROW_UP : ARROW_DOWN}</span><b>${esc(e.label)}</b><span class="what">${e.ok ? t(lang, "recovered") : t(lang, "down")}</span><time>${when(e.at)}</time></li>`
}
