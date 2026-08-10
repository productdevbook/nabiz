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
  css: string,
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
<style>${css}</style>
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
