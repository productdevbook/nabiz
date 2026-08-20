import type { APIRoute } from "astro"
import { env } from "cloudflare:workers"

import { noticesJson } from "../../lib/api.ts"
import { langOf } from "../../lib/i18n.ts"
import { notices } from "../../lib/store.ts"

export const GET: APIRoute = async ({ url }) => {
  // No language asked for means every notice, which is what this endpoint
  // documents. One that was asked for and is not one of the six falls back
  // to the deployment's own, not to English.
  const asked = url.searchParams.get("lang") || null
  const lang = asked === null ? null : langOf(asked, langOf(env.LANG))
  return noticesJson(await notices(env.DB, 10, lang))
}
