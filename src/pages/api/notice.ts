import type { APIRoute } from "astro"
import { env } from "cloudflare:workers"

import { authorized, postNotice, throttled } from "../../lib/api"

export const POST: APIRoute = async ({ request }) => {
  if (throttled(request))
    return new Response(JSON.stringify({ error: "too many attempts" }), {
      status: 429,
      headers: { "content-type": "application/json", "retry-after": "60" },
    })
  if (!(await authorized(request, env.ADMIN_TOKEN)))
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    })
  return postNotice(request, env.DB)
}
