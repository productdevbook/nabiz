import type { Lang } from "./i18n"
import { t } from "./i18n"
import { render } from "./markdown"
import { eventsView, overall, rows, uptimeOf } from "./shape"
import type { DayRow, EventRow, Notice, PageData } from "./store"

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

/** A day of latency as a hairline, drawn only when there is something to
 *  draw and the monitor answers by name. */
function sparkline(points: number[], lang: Lang): string {
  if (points.length < 2) return ""
  const w = 110
  const h = 22
  const max = Math.max(...points)
  const min = Math.min(...points)
  const span = Math.max(max - min, 1)
  const path = points
    .map((p, i) => {
      const x = ((w - 2) * i) / (points.length - 1) + 1
      const y = h - 3 - ((h - 6) * (p - min)) / span
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`
    })
    .join(" ")
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><title>${t(lang, "last_day")}</title><path d="${path}" fill="none" stroke="var(--ok)" stroke-width="1.5" stroke-linejoin="round"/></svg>`
}

function sevLabel(severity: string, lang: Lang): string {
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

function noticesSection(list: Notice[], lang: Lang): string {
  if (list.length === 0) return ""
  const items = list
    .map((n) => {
      const when = new Date(n.at).toISOString().replace("T", " ").slice(0, 16)
      const open = n.resolved_at === null
      const chip = open
        ? `<span class="chip ${esc(n.severity)}">${sevLabel(n.severity, lang)}</span>`
        : `<span class="chip done">${t(lang, "resolved")}</span>`
      return `<article class="notice${open ? "" : " over"}" data-notice="${n.id}"${open ? ' data-open="1"' : ""}>
  <header>${chip}<span class="ev-when">${when} UTC</span></header>
  <div class="md">${render(n.body_md)}</div>
</article>`
    })
    .join("\n")
  return `<h3 class="ev-title">${t(lang, "notices")}</h3>\n${items}`
}

function editor(lang: Lang): string {
  return `<dialog id="ed">
  <h3>${t(lang, "ed_title")}</h3>
  <input id="tok" type="password" placeholder="${t(lang, "ed_token")}" autocomplete="off">
  <select id="sev">
    <option value="info">${t(lang, "sev_info")}</option>
    <option value="maintenance">${t(lang, "sev_maintenance")}</option>
    <option value="degraded">${t(lang, "sev_degraded")}</option>
    <option value="outage">${t(lang, "sev_outage")}</option>
  </select>
  <textarea id="txt" rows="5" placeholder="${t(lang, "ed_body")}"></textarea>
  <div id="resolvables"></div>
  <p id="ederr" class="ederr"></p>
  <footer><button id="cancel" type="button">${t(lang, "ed_cancel")}</button><button id="pub" type="button" class="primary">${t(lang, "ed_publish")}</button></footer>
</dialog>
<script>
(function () {
  var dlg = document.getElementById("ed");
  var tok = document.getElementById("tok");
  var err = document.getElementById("ederr");
  tok.value = localStorage.getItem("nabiz-token") || "";
  function open() { if (!dlg.open) { fill(); dlg.showModal(); } }
  function fill() {
    var box = document.getElementById("resolvables");
    box.innerHTML = "";
    document.querySelectorAll("[data-open]").forEach(function (n) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = "${t(lang, "ed_resolve")} #" + n.dataset.notice;
      b.onclick = function () { send("/api/notice/resolve", { id: Number(n.dataset.notice) }); };
      box.appendChild(b);
    });
  }
  function send(path, body) {
    err.textContent = "";
    fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + tok.value },
      body: JSON.stringify(body),
    }).then(function (r) {
      if (r.ok) { localStorage.setItem("nabiz-token", tok.value); location.href = "/"; }
      else err.textContent = "${t(lang, "ed_failed")}";
    });
  }
  document.getElementById("pub").onclick = function () {
    send("/api/notice", {
      severity: document.getElementById("sev").value,
      body: document.getElementById("txt").value,
    });
  };
  document.getElementById("cancel").onclick = function () { dlg.close(); };
  addEventListener("keydown", function (e) {
    var tag = (document.activeElement || {}).tagName;
    if ((e.key === "n" || e.key === "N") && !e.metaKey && !e.ctrlKey && tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT") open();
  });
  if (location.hash === "#notice") open();
  var pen = document.getElementById("pen");
  if (pen) pen.onclick = function (e) { e.preventDefault(); open(); };
  setInterval(function () { if (!dlg.open) location.reload(); }, 60000);
})();
</script>`
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

export function page(
  data: PageData,
  lang: Lang,
  title: string,
  events: EventRow[],
  noticeList: Notice[],
): string {
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
            ? `${r.spark ? sparkline(r.spark, lang) : ""}<span class="ms">${r.latency} ms</span>`
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
.spark{opacity:.75;margin-right:4px}
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
.notice{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 16px;margin-bottom:10px}
.notice header{display:flex;align-items:center;gap:8px;margin-bottom:6px}
.notice.over{opacity:.62}
.notice .md{font-size:14px}
.notice .md p{margin:4px 0}
.notice .md code{background:var(--bg);border:1px solid var(--line);border-radius:4px;padding:0 4px;font-size:13px}
.notice .md ul{margin:4px 0 4px 18px}
.chip{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;padding:2px 8px;border-radius:99px;color:#fff;background:var(--mut)}
.chip.outage{background:var(--bad)}.chip.degraded{background:var(--meh)}.chip.maintenance{background:#5b7bd5}.chip.done{background:var(--ok)}
dialog{background:var(--card);color:var(--fg);border:1px solid var(--line);border-radius:12px;padding:18px;width:min(440px,92vw)}
dialog::backdrop{background:rgba(0,0,0,.45)}
dialog h3{margin-bottom:10px;font-size:15px}
dialog input,dialog select,dialog textarea{width:100%;margin-bottom:8px;padding:8px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--fg);font:inherit}
dialog footer{display:flex;justify-content:flex-end;gap:8px;margin-top:6px}
dialog button{padding:7px 14px;border-radius:8px;border:1px solid var(--line);background:var(--bg);color:var(--fg);cursor:pointer;font:inherit}
dialog button.primary{background:var(--ok);border-color:var(--ok);color:#fff}
#resolvables{display:flex;flex-direction:column;gap:6px;margin-bottom:6px}
.ederr{color:var(--bad);font-size:13px;min-height:18px}
.page-foot{margin-top:28px;color:var(--mut);font-size:12px;display:flex;justify-content:space-between}
.page-foot a{color:inherit}
.langs a{text-decoration:none;opacity:.7;text-transform:uppercase;font-size:11px}
.langs b{text-transform:uppercase;font-size:11px}
#pen{text-decoration:none;font-size:14px;margin-right:6px}
</style>
</head>
<body>
<h1>${esc(title)}</h1>
<div class="banner ${bannerClass}"><span class="dot ${bannerClass === "ok" ? "ok" : "bad"}"></span>${t(lang, banner)}</div>
${noticesSection(noticeList, lang)}
${items}
${eventsSection(data, events, lang)}
<div class="page-foot"><span>${t(lang, "updated")}: ${now} UTC</span><span class="langs">${(
    ["en", "tr", "de", "es", "fr"] as Lang[]
  )
    .map((l) => (l === lang ? `<b>${l}</b>` : `<a href="?lang=${l}">${l}</a>`))
    .join(
      " ",
    )}</span><span><a href="#notice" id="pen" title="${t(lang, "ed_title")}">✎</a> <a href="https://github.com/productdevbook/nabiz">nabiz</a></span></div>
${editor(lang)}
</body>
</html>`
}
