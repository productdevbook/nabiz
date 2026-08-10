import type { APIRoute } from "astro"
import { env } from "cloudflare:workers"

import { noticesJson } from "../../lib/api"
import { langOf } from "../../lib/i18n"
import { notices } from "../../lib/store"

export const GET: APIRoute = async ({ url }) => {
  const lang = url.searchParams.has("lang")
    ? langOf(url.searchParams.get("lang") ?? undefined)
    : null
  return noticesJson(await notices(env.DB, 10, lang))
}
