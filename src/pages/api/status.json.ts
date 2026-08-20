import type { APIRoute } from "astro"
import { env } from "cloudflare:workers"

import { statusJson } from "../../lib/api.ts"
import { WINDOW } from "../../lib/render.ts"
import { EVENT_ROWS, forPage, recentEvents } from "../../lib/store.ts"

export const GET: APIRoute = async () => {
  return statusJson(await forPage(env.DB, WINDOW), await recentEvents(env.DB, EVENT_ROWS))
}
