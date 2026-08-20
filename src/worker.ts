// The whole worker: Astro answers the requests, the cron keeps probing —
// one deployment, two duties.
import { handle } from "@astrojs/cloudflare/handler"

import { preflight } from "./lib/api.ts"
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
    if (request.method === "OPTIONS") return preflight()

    const url = new URL(request.url)
    const cacheable =
      (request.method === "GET" || request.method === "HEAD") &&
      url.pathname === "/" &&
      !wantsJson(request)
    if (cacheable) {
      const cache = caches.default
      // A HEAD is the cheap question this page advertises, and the cache
      // only keys on GET — so it asks the cache the GET question and
      // answers with the headers alone.
      const head = request.method === "HEAD"
      const key = head ? new Request(url.toString(), { headers: request.headers }) : request
      const hit = await cache.match(key)
      if (hit) return head ? new Response(null, { status: hit.status, headers: hit.headers }) : hit
      const res = await handle(request, env, ctx)
      if (
        !head &&
        res.status === 200 &&
        (res.headers.get("content-type") ?? "").includes("text/html")
      )
        ctx.waitUntil(cache.put(key, res.clone()))
      return res
    }
    return handle(request, env, ctx)
  },
  async scheduled(controller: ScheduledController, env: Env) {
    // Once an hour is often enough to sweep what has aged out.
    await tick(env.DB, env, new Date(controller.scheduledTime).getUTCMinutes() === 0)
  },
} satisfies ExportedHandler<Env>
