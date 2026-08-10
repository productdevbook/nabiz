import type { APIRoute } from "astro"
import { env } from "cloudflare:workers"

import { historyJson } from "../../lib/api"
import { forPage } from "../../lib/store"

export const GET: APIRoute = async () => {
  return historyJson(await forPage(env.DB, 90))
}
