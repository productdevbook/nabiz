import type { APIRoute } from "astro"

import { VERSION } from "../lib/version.ts"

// Alive as long as the worker answers — the one endpoint with no database
// behind it, so the watchers can watch the watcher. CORS-open so a page
// somewhere else can ask, and held by nothing: everything else here reads
// through a page the store holds for a window.
export const GET: APIRoute = () =>
  new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "cache-control": "no-store",
      // The build, where a machine can read it: nothing else a deployment
      // serves says which version is answering.
      "x-nabiz": VERSION,
    },
  })
