import type { Lang } from "./i18n"
import { NAMES, t } from "./i18n"
import { render } from "./markdown"
import { eventsView, overall, rows, uptimeOf } from "./shape"
import type { DayRow, EventRow, Notice, PageData } from "./store"

const WINDOW = 90
const LANGS: Lang[] = ["en", "tr", "de", "es", "fr"]

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

function when(at: number): string {
  return new Date(at).toISOString().replace("T", " ").slice(0, 16) + " UTC"
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

/** A day of latency as a hairline: a number says how it is, a line says how
 *  it has been. */
function sparkline(points: number[], lang: Lang): string {
  if (points.length < 2) return ""
  const w = 96
  const h = 20
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
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><title>${t(lang, "last_day")}</title><path d="${path}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>`
}

function langBar(lang: Lang): string {
  return `<select id="lang" aria-label="language">${LANGS.map(
    (l) => `<option value="${l}"${l === lang ? " selected" : ""}>${NAMES[l]}</option>`,
  ).join("")}</select>`
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

/** An open notice: the operator's voice, above everything else. */
function callout(n: Notice, lang: Lang): string {
  return `<article class="callout ${esc(n.severity)}" data-notice="${n.id}" data-open="1">
  <header><span class="chip ${esc(n.severity)}">${sevLabel(n.severity, lang)}</span><time>${when(n.at)}</time></header>
  <div class="md">${render(n.body_md)}</div>
</article>`
}

/** Resolved notices: still part of the story, no longer part of the noise. */
function noticesSection(list: Notice[], lang: Lang): string {
  const past = list.filter((n) => n.resolved_at !== null)
  if (past.length === 0) return ""
  const items = past
    .map(
      (n) => `<article class="past">
  <header><span class="chip done">${t(lang, "resolved")}</span><time>${when(n.at)}</time></header>
  <div class="md">${render(n.body_md)}</div>
</article>`,
    )
    .join("\n")
  return `<h2 class="sect">${t(lang, "notices")}</h2>\n<div class="card stack">${items}</div>`
}

function eventsSection(data: PageData, events: EventRow[], lang: Lang): string {
  const view = eventsView(data.monitors, events)
  if (view.length === 0) return ""
  const items = view
    .map(
      (e) =>
        `<li><span class="dot ${e.ok ? "ok" : "bad"}"></span><b>${esc(e.label)}</b><span class="what">${e.ok ? t(lang, "recovered") : t(lang, "down")}</span><time>${when(e.at)}</time></li>`,
    )
    .join("\n")
  return `<h2 class="sect">${t(lang, "recent_events")}</h2>\n<ul class="card events">${items}</ul>`
}

function footer(lang: Lang, now: string, penTitle: string): string {
  const links = [
    ["feed.xml", "RSS"],
    ["api/status.json", "status.json"],
    ["api/history.json", "history.json"],
    ["api/notices.json", "notices.json"],
    ["llms.txt", "llms.txt"],
    ["badge.svg", "badge"],
  ]
    .map(([href, label]) => `<a href="/${href}">${label}</a>`)
    .join("<s>·</s>")
  return `<footer class="foot">
  <div class="foot-links">${links}</div>
  <div class="foot-meta"><span>${t(lang, "updated")}: ${now}</span><span><a href="#notice" id="pen" title="${esc(penTitle)}">✎</a> <a href="https://github.com/productdevbook/nabiz">nabiz</a></span></div>
</footer>`
}

function editor(lang: Lang): string {
  const sevs = ["info", "maintenance", "degraded", "outage"] as const
  return `<dialog id="ed">
  <h3>${t(lang, "ed_title")}</h3>
  <div class="seg" id="sev">${sevs
    .map(
      (v, i) =>
        `<button type="button" data-v="${v}" class="${i === 0 ? "on " : ""}${v}">${sevLabel(v, lang)}</button>`,
    )
    .join("")}</div>
  <textarea id="txt" rows="6" placeholder="${t(lang, "ed_body")}"></textarea>
  <div class="pair">
    <select id="nlang" aria-label="language">
      <option value="all">${t(lang, "ed_lang_all")}</option>
      ${LANGS.map((l) => `<option value="${l}"${l === lang ? " selected" : ""}>${NAMES[l]}</option>`).join("")}
    </select>
    <input id="tok" type="password" placeholder="${t(lang, "ed_token")}" autocomplete="off">
  </div>
  <div id="resolvables"></div>
  <p id="ederr" class="ederr"></p>
  <footer><button id="cancel" type="button">${t(lang, "ed_cancel")}</button><button id="pub" type="button" class="primary">${t(lang, "ed_publish")}</button></footer>
</dialog>
<script>
(function () {
  var dlg = document.getElementById("ed");
  var tok = document.getElementById("tok");
  var err = document.getElementById("ederr");
  var sev = "info";
  tok.value = localStorage.getItem("nabiz-token") || "";
  document.querySelectorAll("#sev button").forEach(function (b) {
    b.onclick = function () {
      document.querySelectorAll("#sev button").forEach(function (x) { x.classList.remove("on"); });
      b.classList.add("on");
      sev = b.dataset.v;
    };
  });
  function open() {
    if (dlg.open) return;
    fill();
    dlg.showModal();
    document.getElementById("txt").focus();
  }
  function fill() {
    var box = document.getElementById("resolvables");
    box.replaceChildren();
    document.querySelectorAll("[data-open]").forEach(function (n) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "res";
      b.textContent = "${t(lang, "ed_resolve")} · #" + n.dataset.notice;
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
      severity: sev,
      lang: document.getElementById("nlang").value,
      body: document.getElementById("txt").value,
    });
  };
  document.getElementById("cancel").onclick = function () { dlg.close(); };
  addEventListener("keydown", function (e) {
    var tag = (document.activeElement || {}).tagName;
    if ((e.key === "n" || e.key === "N") && !e.metaKey && !e.ctrlKey && tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT") {
      // Without this the very keystroke that opens the editor types itself
      // into whichever field lands the focus.
      e.preventDefault();
      open();
    }
  });
  var ls = document.getElementById("lang");
  if (ls) ls.onchange = function () { location.search = "?lang=" + ls.value; };
  var pen = document.getElementById("pen");
  if (pen) pen.onclick = function (e) { e.preventDefault(); open(); };
  if (location.hash === "#notice") open();
  setInterval(function () { if (!dlg.open) location.reload(); }, 60000);
})();
</script>`
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
  const now = when(Date.now())
  const open = noticeList.filter((n) => n.resolved_at === null)

  const services = list
    .map((r) => {
      const dot = r.ok === null ? "none" : r.ok ? "ok" : "bad"
      const side =
        r.tally !== null
          ? `<span class="num">${esc(r.tally)} ${t(lang, "up")}</span>`
          : r.latency !== null
            ? `${r.spark ? sparkline(r.spark, lang) : ""}<span class="num">${r.latency} ms</span>`
            : ""
      const pct = uptime(r.days, lang)
      return `<section class="svc">
  <header><span class="dot ${dot}"></span><h3>${esc(r.name)}</h3>${side}</header>
  <div class="bars">${bars(r.days, lang)}</div>
  <footer><span>${WINDOW} ${t(lang, "days")}</span><span>${pct === null ? t(lang, "no_data") : `${pct} ${t(lang, "uptime")}`}</span></footer>
</section>`
    })
    .join("\n")

  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="alternate" type="application/rss+xml" href="/feed.xml">
<style>
:root{--bg:#f6f7f9;--card:#fff;--fg:#191b1f;--mut:#697077;--line:#e6e8ec;--ok:#1a9e6c;--meh:#dd9a2b;--bad:#d64545;--none:#dcdfe4;--shadow:0 1px 2px rgba(16,20,28,.05),0 4px 16px rgba(16,20,28,.04)}
@media (prefers-color-scheme:dark){:root{--bg:#0e0f12;--card:#17181d;--fg:#eceef1;--mut:#9aa1a9;--line:#25272e;--none:#2e3138;--shadow:none}}
*{box-sizing:border-box;margin:0}
body{background:var(--bg);color:var(--fg);font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;max-width:720px;margin:0 auto;padding:28px 20px 56px}
a{color:inherit}
.top{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:22px}
h1{font-size:19px;font-weight:650;letter-spacing:-.2px}
#lang{padding:6px 10px;border:1px solid var(--line);border-radius:9px;background:var(--card);color:var(--fg);font:inherit;font-size:13px;box-shadow:var(--shadow)}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;box-shadow:var(--shadow)}
.banner{display:flex;align-items:center;gap:12px;padding:18px 20px;font-size:16px;font-weight:650;margin-bottom:26px}
.banner.meh{border-color:rgba(221,154,43,.5)}.banner.bad{border-color:rgba(214,69,69,.5)}
.dot{width:9px;height:9px;border-radius:50%;background:var(--none);flex:none;position:relative}
.dot.ok{background:var(--ok)}.dot.bad{background:var(--bad)}
.banner .dot{width:11px;height:11px}
.banner .dot.ok::after{content:"";position:absolute;inset:-5px;border-radius:50%;border:2px solid var(--ok);opacity:.35;animation:ring 2.4s ease-out infinite}
@keyframes ring{0%{transform:scale(.5);opacity:.5}80%{transform:scale(1.15);opacity:0}100%{opacity:0}}
.callout{border-radius:14px;border:1px solid var(--line);border-left:4px solid var(--mut);background:var(--card);box-shadow:var(--shadow);padding:14px 18px;margin-bottom:14px}
.callout.info,.callout.maintenance{border-left-color:#5b7bd5}
.callout.degraded{border-left-color:var(--meh)}
.callout.outage{border-left-color:var(--bad)}
.callout header,.past header{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:7px}
.callout time,.past time,.events time{color:var(--mut);font-size:12px;font-variant-numeric:tabular-nums}
.chip{font-size:10.5px;font-weight:750;text-transform:uppercase;letter-spacing:.5px;padding:3px 9px;border-radius:99px;color:#fff;background:var(--mut)}
.chip.outage{background:var(--bad)}.chip.degraded{background:var(--meh)}.chip.info,.chip.maintenance{background:#5b7bd5}.chip.done{background:var(--ok)}
.md{font-size:14px}
.md p{margin:3px 0}
.md code{background:var(--bg);border:1px solid var(--line);border-radius:5px;padding:0 5px;font-size:13px}
.md ul{margin:5px 0 3px 19px}
.md a{color:#5b7bd5;text-decoration:none}
.md a:hover{text-decoration:underline}
.sect{font-size:13px;font-weight:650;text-transform:uppercase;letter-spacing:.6px;color:var(--mut);margin:26px 0 10px}
.svc{padding:15px 20px 13px}
.svc+.svc{border-top:1px solid var(--line)}
.svc header{display:flex;align-items:center;gap:10px}
.svc h3{font-size:14.5px;font-weight:600;flex:1}
.num{color:var(--mut);font-size:13px;font-variant-numeric:tabular-nums}
.spark{color:var(--ok);opacity:.65;margin-right:2px}
.bars{display:flex;gap:2px;margin:10px 0 7px}
.bars i{flex:1;height:24px;border-radius:2.5px;background:var(--none)}
.bars i.ok{background:var(--ok)}.bars i.meh{background:var(--meh)}.bars i.bad{background:var(--bad)}
.svc footer{display:flex;justify-content:space-between;color:var(--mut);font-size:12px}
.stack .past{padding:13px 20px}
.stack .past+.past{border-top:1px solid var(--line)}
.past{opacity:.75}
.events{list-style:none;padding:5px 20px}
.events li{display:flex;align-items:center;gap:10px;padding:9px 0;font-size:13.5px}
.events li+li{border-top:1px solid var(--line)}
.events b{font-weight:600}
.events .what{color:var(--mut);flex:1}
.foot{margin-top:34px;color:var(--mut);font-size:12.5px}
.foot-links{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:8px}
.foot-links a{text-decoration:none;opacity:.85}
.foot-links a:hover{opacity:1;text-decoration:underline}
.foot-links s{text-decoration:none;opacity:.4}
.foot-meta{display:flex;justify-content:space-between;gap:10px}
.foot-meta a{text-decoration:none}
#pen{margin-right:4px}
dialog{margin:auto;background:var(--card);color:var(--fg);border:1px solid var(--line);border-radius:16px;padding:22px;width:min(480px,92vw);box-shadow:0 12px 40px rgba(8,10,16,.18)}
dialog::backdrop{background:rgba(8,10,14,.45);backdrop-filter:blur(2px)}
dialog[open]{animation:pop .18s ease-out}
@keyframes pop{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:none}}
dialog h3{margin-bottom:14px;font-size:16px;font-weight:650;letter-spacing:-.2px}
.seg{display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap}
.seg button{flex:1;padding:7px 4px;border-radius:9px;border:1px solid var(--line);background:var(--bg);color:var(--mut);cursor:pointer;font:inherit;font-size:12.5px;font-weight:600;white-space:nowrap}
.seg button.on{color:#fff;border-color:transparent}
.seg button.on.info,.seg button.on.maintenance{background:#5b7bd5}
.seg button.on.degraded{background:var(--meh)}
.seg button.on.outage{background:var(--bad)}
dialog textarea{width:100%;margin-bottom:10px;padding:11px 12px;border:1px solid var(--line);border-radius:11px;background:var(--bg);color:var(--fg);font:13.5px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;resize:vertical}
.pair{display:flex;gap:8px;margin-bottom:6px}
.pair select,.pair input{flex:1;min-width:0;padding:9px 11px;border:1px solid var(--line);border-radius:10px;background:var(--bg);color:var(--fg);font:inherit;font-size:13.5px}
dialog textarea:focus,.pair select:focus,.pair input:focus{outline:2px solid #5b7bd5;outline-offset:-1px;border-color:transparent}
dialog footer{display:flex;justify-content:flex-end;gap:8px;margin-top:8px}
dialog footer button{padding:9px 18px;border-radius:10px;border:1px solid var(--line);background:var(--bg);color:var(--fg);cursor:pointer;font:inherit;font-size:14px;font-weight:550}
dialog footer button.primary{background:var(--ok);border-color:var(--ok);color:#fff}
dialog footer button.primary:hover{filter:brightness(1.06)}
#resolvables{display:flex;flex-direction:column;gap:6px;margin-bottom:4px}
#resolvables .res{padding:8px 12px;border-radius:10px;border:1px dashed var(--line);background:transparent;color:var(--mut);cursor:pointer;font:inherit;font-size:13px;text-align:left}
#resolvables .res:hover{color:var(--fg);border-style:solid}
.ederr{color:var(--bad);font-size:13px;min-height:18px}
</style>
</head>
<body>
<div class="top"><h1>${esc(title)}</h1>${langBar(lang)}</div>
${open.map((n) => callout(n, lang)).join("\n")}
<div class="card banner ${bannerClass}"><span class="dot ${bannerClass === "ok" ? "ok" : "bad"}"></span>${t(lang, banner)}</div>
<div class="card">
${services}
</div>
${noticesSection(noticeList, lang)}
${eventsSection(data, events, lang)}
${footer(lang, now, t(lang, "ed_title"))}
${editor(lang)}
</body>
</html>`
}
