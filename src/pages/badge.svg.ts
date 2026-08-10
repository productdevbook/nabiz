import type { APIRoute } from "astro"
import { env } from "cloudflare:workers"

import { badge } from "../lib/api"
import { forPage } from "../lib/store"

export const GET: APIRoute = async () => {
  return badge(await forPage(env.DB, 90))
}
