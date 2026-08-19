// The whole worker: Astro answers the requests, the cron keeps probing —
// one deployment, two duties.
import { handle } from "@astrojs/cloudflare/handler"

import { tick } from "./lib/tick.ts"

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
    // Once an hour is often enough to sweep what has aged out.
    await tick(env.DB, env, new Date(controller.scheduledTime).getUTCMinutes() === 0)
  },
} satisfies ExportedHandler<Env>
