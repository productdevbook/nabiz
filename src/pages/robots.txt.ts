import type { APIRoute } from "astro"

export const GET: APIRoute = ({ url }) => {
  const text = `User-agent: *
Allow: /

# Machines: start at ${url.origin}/llms.txt
`
  return new Response(text, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  })
}
