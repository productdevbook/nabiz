import type { APIRoute } from "astro"

// Alive as long as the worker answers — the one endpoint with no database
// behind it, so the watchers can watch the watcher.
export const GET: APIRoute = () => new Response(null, { status: 204 })
