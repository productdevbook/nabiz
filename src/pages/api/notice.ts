import type { APIRoute } from "astro"
import { env } from "cloudflare:workers"

import { authorized, postNotice } from "../../lib/api"

export const POST: APIRoute = async ({ request }) => {
  if (!(await authorized(request, env.ADMIN_TOKEN)))
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    })
  return postNotice(request, env.DB)
}
