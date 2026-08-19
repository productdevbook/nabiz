import type { APIRoute } from "astro"

// Alive as long as the worker answers — the one endpoint with no database
// behind it, so the watchers can watch the watcher. CORS-open and uncached
// like every other read here, so a page somewhere else can ask too.
export const GET: APIRoute = () =>
  new Response(null, {
    status: 204,
    headers: { "access-control-allow-origin": "*", "cache-control": "no-store" },
  })
