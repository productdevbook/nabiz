import type { Lang } from "./i18n"
import { t } from "./i18n"
import { eventsView, overall, rows, uptimeOf } from "./shape"
import type { DayRow, EventRow, PageData } from "./store"

const WINDOW = 90

function esc(s: string): string {
  return s.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string,
  )
}

// Turkish writes %50, English writes 50% — the sign follows the language.
function percent(pct: number, lang: Lang): string {
  const n = pct.toFixed(pct === 100 ? 0 : 2)
  return lang === "tr" ? `%${n}` : `${n}%`
}

function bars(days: DayRow[], lang: Lang): string {
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

function uptime(days: DayRow[], lang: Lang): string | null {
  const pct = uptimeOf(days)
  return pct === null ? null : percent(pct, lang)
}

function eventsSection(data: PageData, events: EventRow[], lang: Lang): string {
  const view = eventsView(data.monitors, events)
  if (view.length === 0) return ""
  const items = view
    .map((e) => {
      const when = new Date(e.at).toISOString().replace("T", " ").slice(0, 16)
      const word = e.ok ? t(lang, "recovered") : t(lang, "down")
      return `<li><span class="dot ${e.ok ? "ok" : "bad"}"></span><span class="ev-name">${esc(e.label)}</span><span class="ev-what">${word}</span><span class="ev-when">${when} UTC</span></li>`
    })
    .join("\n")
  return `<h3 class="ev-title">${t(lang, "recent_events")}</h3>\n<ul class="events">${items}</ul>`
}

export function page(data: PageData, lang: Lang, title: string, events: EventRow[]): string {
  const list = rows(data)
  const state = overall(list)
  const banner = state === "up" ? "all_up" : state === "down" ? "all_down" : "some_down"
  const bannerClass = state === "up" ? "ok" : state === "down" ? "bad" : "meh"
  const now = new Date().toISOString().replace("T", " ").slice(0, 16)

  const items = list
    .map((r) => {
      const dot = r.ok === null ? "none" : r.ok ? "ok" : "bad"
      const side =
        r.tally !== null
          ? `<span class="tally">${esc(r.tally)} ${t(lang, "up")}</span>`
          : r.latency !== null
            ? `<span class="ms">${r.latency} ms</span>`
            : ""
      const pct = uptime(r.days, lang)
      return `<section>
  <header><span class="dot ${dot}"></span><h2>${esc(r.name)}</h2>${side}</header>
  <div class="bars">${bars(r.days, lang)}</div>
  <footer><span>${WINDOW} ${t(lang, "days")}</span><span>${pct === null ? t(lang, "no_data") : pct + " " + t(lang, "uptime")}</span></footer>
</section>`
    })
    .join("\n")

  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="60">
<title>${esc(title)}</title>
<style>
:root{--bg:#fafafa;--card:#fff;--fg:#1a1a1a;--mut:#777;--line:#e5e5e5;--ok:#22a06b;--meh:#e8a13c;--bad:#d64545;--none:#d9d9d9}
@media (prefers-color-scheme:dark){:root{--bg:#111214;--card:#1a1c1f;--fg:#ececec;--mut:#9a9a9a;--line:#2a2d31;--none:#33363b}}
*{box-sizing:border-box;margin:0}
body{background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif;max-width:680px;margin:0 auto;padding:24px 16px 48px}
h1{font-size:18px;font-weight:600}
.banner{display:flex;align-items:center;gap:10px;margin:20px 0 28px;padding:14px 16px;border-radius:10px;background:var(--card);border:1px solid var(--line);font-weight:600}
.banner .dot{width:12px;height:12px}
.dot{display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--none);flex:none}
.dot.ok{background:var(--ok)}.dot.bad{background:var(--bad)}
section{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px;margin-bottom:12px}
section header{display:flex;align-items:center;gap:9px}
section h2{font-size:15px;font-weight:600;flex:1}
.ms,.tally{color:var(--mut);font-size:13px;font-variant-numeric:tabular-nums}
.bars{display:flex;gap:2px;margin:10px 0 6px}
.bars i{flex:1;height:26px;border-radius:2px;background:var(--none)}
.bars i.ok{background:var(--ok)}.bars i.meh{background:var(--meh)}.bars i.bad{background:var(--bad)}
section footer{display:flex;justify-content:space-between;color:var(--mut);font-size:12px}
.ev-title{font-size:14px;font-weight:600;margin:26px 0 10px}
.events{list-style:none;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:6px 16px}
.events li{display:flex;align-items:center;gap:9px;padding:8px 0;border-bottom:1px solid var(--line);font-size:13px}
.events li:last-child{border-bottom:none}
.ev-name{font-weight:600}
.ev-what{color:var(--mut);flex:1}
.ev-when{color:var(--mut);font-variant-numeric:tabular-nums}
.page-foot{margin-top:28px;color:var(--mut);font-size:12px;display:flex;justify-content:space-between}
.page-foot a{color:inherit}
</style>
</head>
<body>
<h1>${esc(title)}</h1>
<div class="banner ${bannerClass}"><span class="dot ${bannerClass === "ok" ? "ok" : "bad"}"></span>${t(lang, banner)}</div>
${items}
${eventsSection(data, events, lang)}
<div class="page-foot"><span>${t(lang, "updated")}: ${now} UTC</span><a href="https://github.com/productdevbook/nabiz">nabiz</a></div>
</body>
</html>`
}
