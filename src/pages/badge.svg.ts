import type { APIRoute } from "astro"
import { env } from "cloudflare:workers"

import { badge } from "../lib/api.ts"
import { WINDOW } from "../lib/render.ts"
import { forPage } from "../lib/store.ts"

export const GET: APIRoute = async () => {
  return badge(await forPage(env.DB, WINDOW))
}
