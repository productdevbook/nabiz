// The page's HTML fragments — everything data-shaped, kept out of the
// component so it stays testable and the component stays readable.
import type { Lang } from "./i18n"
import { t } from "./i18n"
import { render } from "./markdown"
import type { Row } from "./shape"
import { uptimeOf } from "./shape"
import type { DayRow, EventRow, Notice } from "./store"

export const WINDOW = 90

export function esc(s: string): string {
  return s.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string,
  )
}

// Turkish writes %50, English writes 50% — the sign follows the language.
export function percent(pct: number, lang: Lang): string {
  const n = pct.toFixed(pct === 100 ? 0 : 2)
  return lang === "tr" ? `%${n}` : `${n}%`
}

export function when(at: number): string {
  return new Date(at).toISOString().replace("T", " ").slice(0, 16) + " UTC"
}

export function bars(days: DayRow[], lang: Lang): string {
  const byDay = new Map(days.map((d) => [d.day, d]))
  const cells: string[] = []
  for (let i = WINDOW - 1; i >= 0; i--) {
    const day = new Date(Date.now() - i * 24 * 3600 * 1000).toISOString().slice(0, 10)
    const d = byDay.get(day)
    if (d === undefined || d.total === 0) {
      cells.push(`<i title="${day} · ${t(lang, "no_data")}"></i>`)
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
export function sparkline(points: number[], lang: Lang): string {
  if (points.length < 2) return ""
  const w = 72
  const h = 16
  const max = Math.max(...points)
  const min = Math.min(...points)
  const span = Math.max(max - min, 1)
  const xy = points.map((p, i) => {
    const x = ((w - 4) * i) / (points.length - 1) + 2
    const y = h - 2.5 - ((h - 6) * (p - min)) / span
    return [x, y] as const
  })
  const line = xy
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(" ")
  const [ex, ey] = xy[xy.length - 1] as readonly [number, number]
  const area = `${line} L${ex.toFixed(1)} ${h - 1} L2 ${h - 1} Z`
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
  return `<section class="svc">
  <header>
    <div class="who"><h3>${esc(r.name)}</h3><span class="state ${dot}">${word}</span>${tele}</div>
    ${figure}
  </header>
  <div class="bars">${bars(r.days, lang)}</div>
  <footer><span>${t(lang, "window_ago").replace("{n}", String(WINDOW))}</span><span>${t(lang, "today")}</span></footer>
</section>`
}

const ARROW_UP = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 7h10v10"/><path d="M7 17 17 7"/></svg>`
const ARROW_DOWN = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m7 7 10 10"/><path d="M17 7v10H7"/></svg>`

export function eventLine(e: { label: string; at: number; ok: boolean }, lang: Lang): string {
  return `<li><span class="dot ${e.ok ? "ok" : "bad"}">${e.ok ? ARROW_UP : ARROW_DOWN}</span><b>${esc(e.label)}</b><span class="what">${e.ok ? t(lang, "recovered") : t(lang, "down")}</span><time>${when(e.at)}</time></li>`
}

export type { EventRow }
