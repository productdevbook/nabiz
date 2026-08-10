import { alert } from "./alert"
import {
  authorized,
  badge,
  feed,
  historyJson,
  llms,
  noticesJson,
  postNotice,
  postResolve,
  statusJson,
} from "./api"
import { langOf } from "./i18n"
import { page } from "./page"
import { probe } from "./probe"
import { forPage, monitors, notices, prune, recentEvents, record } from "./store"

export interface Env {
  DB: D1Database
  LANG?: string
  TITLE?: string
  ADMIN_TOKEN?: string
  TELEGRAM_BOT_TOKEN?: string
  TELEGRAM_CHAT_ID?: string
  ALERT_WEBHOOK_URL?: string
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const title = env.TITLE ?? "nabiz"
    // A visitor's tongue beats the operator's default, but only for them.
    const lang = langOf(url.searchParams.get("lang") ?? env.LANG)

    // Alive as long as the worker answers — the one endpoint with no D1
    // behind it, so the watchers can watch the watcher.
    if (url.pathname === "/health") return new Response(null, { status: 204 })
    if (url.pathname === "/llms.txt" || url.pathname === "/api/llms.txt")
      return llms(url.origin, title)

    if (
      request.method === "POST" &&
      (url.pathname === "/api/notice" || url.pathname === "/api/notice/resolve")
    ) {
      if (!(await authorized(request, env.ADMIN_TOKEN)))
        return new Response(JSON.stringify({ error: "unauthorized" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        })
      return url.pathname === "/api/notice"
        ? postNotice(request, env.DB)
        : postResolve(request, env.DB)
    }
    if (url.pathname === "/api/notices.json")
      return noticesJson(await notices(env.DB, 10, url.searchParams.has("lang") ? lang : null))

    if (url.pathname === "/api/status.json") {
      const data = await forPage(env.DB, 90)
      return statusJson(data, await recentEvents(env.DB, 20))
    }
    if (url.pathname === "/api/history.json") return historyJson(await forPage(env.DB, 90))
    if (url.pathname === "/feed.xml") {
      const data = await forPage(env.DB, 90)
      return feed(
        url.origin,
        title,
        data,
        await recentEvents(env.DB, 50),
        await notices(env.DB, 10, lang),
        lang,
      )
    }
    if (url.pathname === "/badge.svg") return badge(await forPage(env.DB, 90))

    if (url.pathname !== "/") return new Response("not found", { status: 404 })
    const data = await forPage(env.DB, 90)
    return new Response(
      page(data, lang, title, await recentEvents(env.DB, 10), await notices(env.DB, 3, lang)),
      {
        headers: {
          "content-type": "text/html; charset=utf-8",
          // A status page that caches is a status page that lies.
          "cache-control": "no-store",
        },
      },
    )
  },

  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    const watched = await monitors(env.DB)
    if (watched.length === 0) return

    const results = await Promise.all(watched.map(probe))
    const changes = await record(env.DB, results)
    await alert(env, changes, langOf(env.LANG))

    // Once an hour is often enough to sweep two-day-old rows.
    if (new Date(controller.scheduledTime).getUTCMinutes() === 0) await prune(env.DB)
  },
} satisfies ExportedHandler<Env>
