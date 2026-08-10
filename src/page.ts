import type { Lang } from "./i18n"
import { t } from "./i18n"
import type { Monitor } from "./probe"
import type { DayRow, PageData } from "./store"

const WINDOW = 90

interface Row {
  name: string
  ok: boolean | null
  days: DayRow[]
  latency: number | null
  tally: string | null
}

function esc(s: string): string {
  return s.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string,
  )
}

function mergeDays(lists: DayRow[][]): DayRow[] {
  const byDay = new Map<string, DayRow>()
  for (const list of lists)
    for (const d of list) {
      const m = byDay.get(d.day) ?? { monitor_id: 0, day: d.day, total: 0, ok: 0, ms_sum: 0 }
      m.total += d.total
      m.ok += d.ok
      m.ms_sum += d.ms_sum
      byDay.set(d.day, m)
    }
  return [...byDay.values()].toSorted((a, b) => (a.day < b.day ? -1 : 1))
}

function rows(data: PageData): Row[] {
  const out: Row[] = []
  const grouped = new Map<string, Monitor[]>()

  for (const m of data.monitors) {
    if (m.grouped && m.group_name) {
      const list = grouped.get(m.group_name) ?? []
      list.push(m)
      grouped.set(m.group_name, list)
      continue
    }
    const s = data.states.get(m.id)
    out.push({
      name: m.name,
      ok: s ? s.ok : null,
      days: data.days.get(m.id) ?? [],
      latency: data.latency.get(m.id) ?? null,
      tally: null,
    })
  }

  for (const [name, members] of grouped) {
    const up = members.filter((m) => data.states.get(m.id)?.ok).length
    const known = members.filter((m) => data.states.get(m.id) !== undefined).length
    out.push({
      name,
      ok: known === 0 ? null : up === known,
      days: mergeDays(members.map((m) => data.days.get(m.id) ?? [])),
      latency: null,
      tally: known === 0 ? null : `${up}/${known}`,
    })
  }
  return out
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
  let total = 0
  let ok = 0
  for (const d of days) {
    total += d.total
    ok += d.ok
  }
  if (total === 0) return null
  return percent((100 * ok) / total, lang)
}

export function page(data: PageData, lang: Lang, title: string): string {
  const list = rows(data)
  const known = list.filter((r) => r.ok !== null)
  const downs = known.filter((r) => r.ok === false).length
  const banner =
    known.length === 0 || downs === 0 ? "all_up" : downs === known.length ? "all_down" : "some_down"
  const bannerClass = banner === "all_up" ? "ok" : banner === "all_down" ? "bad" : "meh"
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
.page-foot{margin-top:28px;color:var(--mut);font-size:12px;display:flex;justify-content:space-between}
.page-foot a{color:inherit}
</style>
</head>
<body>
<h1>${esc(title)}</h1>
<div class="banner ${bannerClass}"><span class="dot ${bannerClass === "ok" ? "ok" : "bad"}"></span>${t(lang, banner)}</div>
${items}
<div class="page-foot"><span>${t(lang, "updated")}: ${now} UTC</span><a href="https://github.com/productdevbook/nabiz">nabiz</a></div>
</body>
</html>`
}
