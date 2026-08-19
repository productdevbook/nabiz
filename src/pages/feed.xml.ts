import type { APIRoute } from "astro"
import { env } from "cloudflare:workers"

import { feed } from "../lib/api.ts"
import { langOf } from "../lib/i18n.ts"
import { forPage, notices, recentEvents } from "../lib/store.ts"

export const GET: APIRoute = async ({ url }) => {
  const lang = langOf(url.searchParams.get("lang") ?? env.LANG)
  return feed(
    url.origin,
    env.TITLE ?? "nabiz",
    await forPage(env.DB, 90),
    await recentEvents(env.DB, 50),
    await notices(env.DB, 10, lang),
    lang,
  )
}
