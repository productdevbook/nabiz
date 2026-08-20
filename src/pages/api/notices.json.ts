import type { APIRoute } from "astro"
import { env } from "cloudflare:workers"

import { noticesJson } from "../../lib/api.ts"
import { langOf } from "../../lib/i18n.ts"
import { notices } from "../../lib/store.ts"

export const GET: APIRoute = async ({ url }) => {
  // `?lang=` with nothing after it is not a language: `get` answers "",
  // which is not one of the five, and answering English to a deployment
  // that speaks Turkish is what `||` is here to stop. No language asked
  // for means every notice, which is what this endpoint documents.
  const asked = url.searchParams.get("lang") || null
  const lang = asked === null ? null : langOf(asked)
  return noticesJson(await notices(env.DB, 10, lang))
}
