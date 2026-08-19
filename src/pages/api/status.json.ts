import type { APIRoute } from "astro"
import { env } from "cloudflare:workers"

import { statusJson } from "../../lib/api.ts"
import { forPage, recentEvents } from "../../lib/store.ts"

export const GET: APIRoute = async () => {
  return statusJson(await forPage(env.DB, 90), await recentEvents(env.DB, 20))
}
