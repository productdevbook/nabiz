// The whole worker: Astro answers the requests, the cron keeps probing —
// one deployment, two duties.
import { handle } from "@astrojs/cloudflare/handler"

import { alert } from "./lib/alert"
import { langOf } from "./lib/i18n"
import { probe } from "./lib/probe"
import { monitors, prune, record } from "./lib/store"

/** A status page's traffic spikes exactly when things are down. The page
 *  is held at the edge for less than a probe interval, so nothing served
 *  from cache is ever staler than the data behind it. JSON askers skip
 *  the cache: the entry is HTML and they negotiate their own answer. */
const wantsJson = (request: Request): boolean => {
  const accept = request.headers.get("accept") ?? ""
  return accept.includes("application/json") && !accept.includes("text/html")
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    if (request.method === "GET" && url.pathname === "/" && !wantsJson(request)) {
      const cache = caches.default
      const hit = await cache.match(request)
      if (hit) return hit
      const res = await handle(request, env, ctx)
      if (res.status === 200 && (res.headers.get("content-type") ?? "").includes("text/html"))
        ctx.waitUntil(cache.put(request, res.clone()))
      return res
    }
    return handle(request, env, ctx)
  },
  async scheduled(controller: ScheduledController, env: Env) {
    const watched = await monitors(env.DB)
    if (watched.length === 0) return

    const results = await Promise.all(watched.map(probe))
    const changes = await record(env.DB, results)
    await alert(env, changes, langOf(env.LANG))

    // Once an hour is often enough to sweep what has aged out.
    if (new Date(controller.scheduledTime).getUTCMinutes() === 0) await prune(env.DB)
  },
} satisfies ExportedHandler<Env>
