// nabiz on a machine somebody owns: the same Astro output, the same probe
// round, the same schema — with an interval where the Workers cron was and
// a file where D1 was.
import { constants, createReadStream } from "node:fs"
import { access, chmod, readFile, realpath, stat } from "node:fs/promises"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { extname, join, normalize, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

import { preflight } from "../lib/api.ts"
import { tick } from "../lib/tick.ts"
import { clientAddress, trustedHops } from "./address.ts"
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

// A number that is not one falls back rather than through: Node reads a
// NaN interval as one millisecond, which would probe in a tight loop.
const positive = (value: string | undefined, fallback: number): number => {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

const port = positive(process.env.PORT, 8080)
const host = process.env.HOST ?? "0.0.0.0"
const interval = positive(process.env.NABIZ_INTERVAL_MS, 60_000)
const hops = trustedHops(process.env.TRUST_PROXY)

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
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(404).end()
    return
  }
  let path: string
  try {
    // Decoded before it is normalised, or "%2e%2e%2f" is a directory name
    // to look for rather than the climb it is.
    path = decodeURIComponent(new URL(req.url ?? "/", "http://host").pathname)
  } catch {
    res.writeHead(400).end()
    return
  }
  const asked = join(client, normalize(path))
  // A path that climbs out of the client directory is not a typo to serve,
  // and neither is a sibling directory whose name begins with the same
  // letters.
  if (!asked.startsWith(client + sep)) {
    res.writeHead(404).end()
    return
  }
  try {
    // The built directory is what is served, not wherever a link in it
    // points: the check above is on the name, this one is on the file.
    const file = await realpath(asked)
    if (!file.startsWith(client + sep)) {
      res.writeHead(404).end()
      return
    }
    const found = await stat(file)
    if (!found.isFile()) {
      res.writeHead(404).end()
      return
    }
    // Readable now, not merely there: a file that stats and then refuses
    // to open would throw on a later tick, where nothing is catching.
    await access(file, constants.R_OK)
    res.writeHead(200, {
      "content-type": TYPES[extname(file)] ?? "application/octet-stream",
      "content-length": found.size,
      // Astro fingerprints what it builds; everything else is asked for again.
      "cache-control": path.startsWith("/_astro/")
        ? "public, max-age=31536000, immutable"
        : "public, max-age=3600",
    })
    if (req.method === "HEAD") {
      res.end()
      return
    }
    const stream = createReadStream(file)
    // A read that fails mid-body cannot be answered — the status is
    // already sent — but it must not take the process with it.
    stream.on("error", () => res.destroy())
    // A client that walks away mid-download leaves the file open otherwise.
    res.on("close", () => stream.destroy())
    stream.pipe(res)
  } catch {
    res.writeHead(404).end()
  }
}

/** The throttle counts by address, and on the edge the address arrives in
 *  a header nobody outside Cloudflare can set. Here the header is written
 *  rather than read, so a forged one counts for nothing. */
function stampAddress(req: IncomingMessage): void {
  const forwarded = req.headers["x-forwarded-for"]
  req.headers["cf-connecting-ip"] = clientAddress(
    Array.isArray(forwarded) ? forwarded.join(",") : forwarded,
    req.socket.remoteAddress,
    hops,
  )
}

async function main(): Promise<void> {
  // The database holds the URLs of what is watched, which are often
  // somebody's hostnames; on a volume another workload can mount, the
  // default mode would hand them over. Set before the file is made, so
  // the write-ahead log and the shared-memory file inherit it.
  process.umask(0o077)

  // Additive and idempotent, the same file the Workers deployment runs.
  await db.exec(await readFile(schemaFile, "utf8"))
  // The umask covers what this process creates; a file that arrived by
  // some other route — a copy out of D1, a restored backup — is narrowed
  // here. Somebody else's file is theirs to set.
  await chmod(DB_PATH, 0o600).catch(() => {})

  const built = await stat(entryFile).catch(() => null)
  if (built === null) {
    console.error(`[nabiz] no built site at ${entryFile} — run \`bun run build:server\` first`)
    process.exit(1)
  }
  let handler: Handler
  try {
    ;({ handler } = (await import(`file://${entryFile}`)) as { handler: Handler })
  } catch (error) {
    // Both targets build into the same directory, so the site that is
    // there may be the Worker's, which imports things only Workers have.
    console.error(
      `[nabiz] ${entryFile} did not load — if the last build was \`bun run build\`, this dist is the Worker's; run \`bun run build:server\``,
    )
    throw error
  }

  const server = createServer((req, res) => {
    stampAddress(req)
    if (req.method === "OPTIONS") {
      const answer = preflight()
      const headers: Record<string, string> = {}
      answer.headers.forEach((value, name) => (headers[name] = value))
      res.writeHead(answer.status, headers).end()
      return
    }
    try {
      handler(req, res, () => {
        void serveStatic(req, res)
      })
    } catch (error) {
      // A page that throws is a page that is down; the process is not.
      console.error("[nabiz] the request failed:", error)
      if (!res.headersSent) res.writeHead(500)
      res.end()
    }
  })

  server.on("error", (error) => {
    console.error(`[nabiz] cannot listen on ${host}:${port} —`, error.message)
    process.exit(1)
  })

  let round: Promise<void> | null = null
  let beating = false
  // Zero, not now: the Workers cron prunes on the wall clock, and a
  // process restarted more often than hourly would otherwise never sweep.
  let swept = 0
  const beat = async (): Promise<void> => {
    // A round that outlives its interval must not have a second one on top
    // of it: the probes would double and the state machine would see the
    // same minute twice.
    if (beating) return
    beating = true
    try {
      const sweep = Date.now() - swept >= 3600_000
      await tick(db, env, sweep)
      // Only a round that finished counts as the hour's sweep; the one
      // that failed on a full disk is the one that needed to prune.
      if (sweep) swept = Date.now()
    } catch (error) {
      console.error("[nabiz] the probe round failed:", error)
    } finally {
      beating = false
    }
  }

  const start = () => {
    round = beat()
  }
  const timer = setInterval(start, interval)
  start()

  server.listen(port, host, () => {
    console.log(`[nabiz] listening on http://${host}:${port} — database ${DB_PATH}`)
  })

  const stop = (signal: string) => {
    console.log(`[nabiz] ${signal}, stopping`)
    clearInterval(timer)
    server.close(() => {
      // The round in flight keeps its database until it has written what
      // it probed; closing underneath it would throw away the minute.
      void Promise.resolve(round)
        .then(() => db.close())
        .then(() => process.exit(0))
    })
    // A connection somebody left open is not a reason to stay forever.
    setTimeout(() => process.exit(0), 5_000).unref()
  }
  process.on("SIGTERM", () => stop("SIGTERM"))
  process.on("SIGINT", () => stop("SIGINT"))
}

await main()
