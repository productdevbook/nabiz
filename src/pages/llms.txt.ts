import type { APIRoute } from "astro"
import { env } from "cloudflare:workers"

import { llms } from "../lib/api"

export const GET: APIRoute = ({ url }) => {
  return llms(url.origin, env.TITLE ?? "nabiz")
}
