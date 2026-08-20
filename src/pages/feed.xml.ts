import type { APIRoute } from "astro"
import { env } from "cloudflare:workers"

import { feed } from "../lib/api.ts"
import { langOf } from "../lib/i18n.ts"
import { WINDOW } from "../lib/render.ts"
import { EVENT_ROWS, forPage, notices, recentEvents } from "../lib/store.ts"

export const GET: APIRoute = async ({ url }) => {
  const lang = langOf(url.searchParams.get("lang") || env.LANG)
  return feed(
    url.origin,
    env.TITLE ?? "nabiz",
    await forPage(env.DB, WINDOW),
    await recentEvents(env.DB, EVENT_ROWS),
    await notices(env.DB, 10, lang),
    lang,
  )
}
