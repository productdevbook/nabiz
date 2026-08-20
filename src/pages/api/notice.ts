import type { APIRoute } from "astro"
import { env } from "cloudflare:workers"

import { authorized, forgive, postNotice, refused, throttled } from "../../lib/api.ts"

export const POST: APIRoute = async ({ request }) => {
  if (throttled(request)) return refused("throttled")
  if (!(await authorized(request, env.ADMIN_TOKEN))) return refused("unauthorized")
  forgive(request)
  return postNotice(request, env.DB)
}
