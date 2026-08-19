// nabiz on a machine somebody owns: the same Astro output, the same probe
// round, the same schema — with an interval where the Workers cron was and
// a file where D1 was.
import { createReadStream } from "node:fs"
import { readFile, stat } from "node:fs/promises"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { extname, join, normalize, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { tick } from "../lib/tick.ts"
import { db, DB_PATH, env } from "./env.ts"

type Next = () => void
type Handler = (req: IncomingMessage, res: ServerResponse, next: Next) => void

const root = fileURLToPath(new URL("../../", import.meta.url))
const dist = resolve(process.env.NABIZ_DIST ?? join(root, "dist"))
const client = join(dist, "client")
const schemaFile = process.env.NABIZ_SCHEMA ?? join(root, "schema.sql")
// A checkout has a directory of chunks here; the container has the same
// path with one bundled file in it. The adapter walks up from this file to
// find the client assets, so the "server" segment stays either way.
const entryFile = join(dist, "server", "entry.mjs")

const port = Number(process.env.PORT ?? 8080)
const host = process.env.HOST ?? "0.0.0.0"
const interval = Number(process.env.NABIZ_INTERVAL_MS ?? 60_000)
const trustProxy = (process.env.TRUST_PROXY ?? "") !== ""

const TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
}

/** Whatever Astro did not claim is a file it built, or nothing at all. */
async function serveStatic(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const path = new URL(req.url ?? "/", "http://host").pathname
  const file = join(client, normalize(path))
  // A path that climbs out of the client directory is not a typo to serve.
  if (!file.startsWith(client) || (req.method !== "GET" && req.method !== "HEAD")) {
    res.writeHead(404).end()
    return
  }
  try {
    const found = await stat(file)
    if (!found.isFile()) {
      res.writeHead(404).end()
      return
    }
    res.writeHead(200, {
      "content-type": TYPES[extname(file)] ?? "application/octet-stream",
      "content-length": found.size,
      // Astro fingerprints what it builds; everything else is asked for again.
      "cache-control": path.startsWith("/_astro/")
        ? "public, max-age=31536000, immutable"
        : "public, max-age=3600",
    })
    if (req.method === "HEAD") res.end()
    else createReadStream(file).pipe(res)
  } catch {
    res.writeHead(404).end()
  }
}

/** The throttle counts by address, and on the edge the address arrives in
 *  a header nobody outside Cloudflare can set. Here the header is written
 *  rather than read, so a forged one counts for nothing. */
function stampAddress(req: IncomingMessage): void {
  const forwarded = String(req.headers["x-forwarded-for"] ?? "")
    .split(",")[0]
    ?.trim()
  const address = trustProxy && forwarded ? forwarded : (req.socket.remoteAddress ?? "?")
  req.headers["cf-connecting-ip"] = address
}

async function main(): Promise<void> {
  // Additive and idempotent, the same file the Workers deployment runs.
  await db.exec(await readFile(schemaFile, "utf8"))

  const { handler } = (await import(`file://${entryFile}`)) as { handler: Handler }

  const server = createServer((req, res) => {
    stampAddress(req)
    handler(req, res, () => {
      void serveStatic(req, res)
    })
  })

  let beating = false
  let swept = Date.now()
  const beat = async (): Promise<void> => {
    // A round that outlives its interval must not have a second one on top
    // of it: the probes would double and the state machine would see the
    // same minute twice.
    if (beating) return
    beating = true
    try {
      const sweep = Date.now() - swept >= 3600_000
      if (sweep) swept = Date.now()
      await tick(db, env, sweep)
    } catch (error) {
      console.error("[nabiz] the probe round failed:", error)
    } finally {
      beating = false
    }
  }

  const timer = setInterval(() => void beat(), interval)
  void beat()

  server.listen(port, host, () => {
    console.log(`[nabiz] listening on http://${host}:${port} — database ${DB_PATH}`)
  })

  const stop = (signal: string) => {
    console.log(`[nabiz] ${signal}, stopping`)
    clearInterval(timer)
    server.close(() => {
      void db.close().then(() => process.exit(0))
    })
    // A connection somebody left open is not a reason to stay forever.
    setTimeout(() => process.exit(0), 5_000).unref()
  }
  process.on("SIGTERM", () => stop("SIGTERM"))
  process.on("SIGINT", () => stop("SIGINT"))
}

await main()
