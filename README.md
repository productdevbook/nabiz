<p align="center">
  <img src="docs/cover.svg" alt="nabiz" width="100%">
</p>

[![CI](https://github.com/productdevbook/nabiz/actions/workflows/ci.yml/badge.svg)](https://github.com/productdevbook/nabiz/actions/workflows/ci.yml)
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/productdevbook/nabiz)

# nabiz

Self-hosted status page. On Cloudflare it is a single Worker: Astro
renders the page, a cron trigger runs the probes, D1 stores the history,
and it fits in the free tier. The same source runs as a single container
on a machine you own — the same page, an interval where the cron was, and
SQLite where D1 was. *nabız* is Turkish for "pulse"; the ASCII spelling
`nabiz` is used throughout.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/screenshot-dark.png">
    <img src="docs/screenshot-light.png" alt="screenshot" width="560">
  </picture>
</p>

## Features

- One probe per monitor per minute: method, expected status code, timeout,
  optional response-body match.
- Anti-flap: a monitor is reported down after `fail_threshold` consecutive
  failures (default 2); recovery is immediate.
- 90-day uptime bars and a 24-hour latency sparkline per monitor.
- Grouped monitors: shown as a tally ("6/6 up") without listing names.
- Operator notices in markdown: severity, per-language targeting,
  resolve — via the page (`n` shortcut) or the API.
- Alerts to Telegram and/or a webhook on state changes.
- Five languages (en, tr, de, es, fr), light/dark theme, auto-refresh.
- JSON API, RSS feed, SVG badge, `llms.txt`.
- Two ways to run it: Cloudflare Workers, or a container on hardware you
  own — one schema, so a database moves between them.

Not included: incident timelines, subscriber emails, multi-region probes.

## On Cloudflare

```sh
git clone https://github.com/productdevbook/nabiz && cd nabiz
bun install
bunx wrangler d1 create nabiz                        # put the id into wrangler.toml
bunx wrangler d1 execute nabiz --remote --file schema.sql
bun run deploy                                       # astro build + wrangler deploy
```

Add monitors as rows (there is no config file for them):

```sql
INSERT INTO monitors (slug, name, url, group_name, grouped, position) VALUES
  ('api',    'API',        'https://api.example.com/health', NULL, 0, 1),
  ('site-a', 'customer a', 'https://a.example', 'Hosted sites', 1, 10);
```

```sh
bunx wrangler d1 execute nabiz --remote --command "INSERT INTO monitors …"
```

To serve on your own hostname, uncomment `routes` in `wrangler.toml`.

## On a machine you own

One image, one volume, one port. Nothing to configure at boot: an empty
volume comes up as an empty, working page, and monitors are rows you add
to the database inside it.

```sh
docker run -d --name nabiz -p 8080:8080 -v nabiz:/data \
  -e NABIZ_TITLE="status" -e NABIZ_LANG=en -e ADMIN_TOKEN=… \
  ghcr.io/productdevbook/nabiz:latest
```

Or with [`compose.yaml`](compose.yaml): `docker compose up -d`. In a
cluster: [`deploy/k8s`](deploy/k8s/README.md).

Monitors go in the same way as everywhere else — as rows. The image has
bun, so `bun:sqlite` is the way in; there is no `sqlite3` binary:

```sh
docker exec nabiz bun -e '
  import { Database } from "bun:sqlite"
  new Database("/data/nabiz.db").run(
    "INSERT INTO monitors (slug, name, url, position) VALUES (?, ?, ?, ?)",
    ["api", "API", "https://api.example.com/health", 1],
  )
'
```

From a checkout instead of an image, with bun or Node 24+:

```sh
bun run build:server     # astro build for the server target
bun run start            # or: node src/server/index.ts
```

The probe loop runs in the same process on an interval; there is no host
cron to add. Probes leave from wherever the container runs, which is the
point when what you watch is behind a firewall no edge can reach — and
the reason to keep a Cloudflare deployment as well when what you watch is
the machine the page is on.

## Configuration

On Cloudflare these are `[vars]` in `wrangler.toml` and secrets set with
`wrangler secret put`; on a server they are environment variables.

| Worker | Server | Purpose |
|---|---|---|
| `TITLE` | `NABIZ_TITLE` | page title |
| `LANG` | `NABIZ_LANG` | default language (`en`, `tr`, `de`, `es`, `fr`) |
| `ADMIN_TOKEN` | `ADMIN_TOKEN` | enables notice writing; without it all writes are refused |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | same | Telegram alerts (optional) |
| `ALERT_WEBHOOK_URL` | same | webhook alerts (optional) |

The server target reads a few more, all optional: `PORT` (8080), `HOST`
(0.0.0.0), `NABIZ_DB` (`/data/nabiz.db`), `NABIZ_INTERVAL_MS` (60000) and
`TRUST_PROXY` — the number of proxies in front that write
`x-forwarded-for` (`1` for the usual one). The notice endpoint counts
guesses at the token by address; unset, every request behind a proxy
looks like the proxy, and set too high it would believe an address the
client typed. Leave it unset when nothing is in front.

## Notices

On the page: press `n` (or open `/#notice`), enter the token, write
markdown, pick a severity and a language, publish. Open notices show a
resolve button in the same dialog.

Over the API:

```sh
curl -X POST https://status.example.com/api/notice \
  -H "authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d '{"severity": "maintenance", "lang": "all", "body": "Planned window 02:00-03:00 UTC."}'

curl -X POST https://status.example.com/api/notice/resolve \
  -H "authorization: Bearer $TOKEN" -H "content-type: application/json" -d '{"id": 1}'
```

Severities: `info`, `maintenance`, `degraded`, `outage`. `lang` is one of
the five languages or `all`.

## API

Read-only, CORS-enabled, uncached. Every endpoint accepts `?lang=`.

| Endpoint | Returns |
|---|---|
| `/api/status.json` | overall state, per-monitor status, uptime, latency, recent events |
| `/api/history.json` | 90 days of daily totals per monitor |
| `/api/notices.json` | notices, markdown and rendered HTML |
| `/badge.svg` | overall state as an SVG badge |
| `/feed.xml` | state changes and notices as RSS |
| `/llms.txt` | endpoint documentation in plain text |
| `/health` | 204, no database access |

Machine access without HTML scraping:

- Every response carries an `x-status` header: `up`, `degraded` or `down`.
  A `HEAD /` request is enough to read the overall state.
- `GET /` with `Accept: application/json` (and no `text/html`) returns the
  `status.json` body.
- A `Link` header on `/` points to `llms.txt`, the JSON and the RSS feed.

## Development

```sh
bun run dev                                               # dev server with local D1
bunx wrangler d1 execute nabiz --local --file schema.sql  # once, creates the local db
bun run check                                             # typecheck + lint + format + tests
bun run build && bun run build:server                     # both targets, both typechecks
```

Everything under `src/lib/` is plain TypeScript against a narrow database
interface (`src/lib/db.ts`) that D1 already satisfies and SQLite is made
to (`src/lib/sqlite.ts`). That seam is the whole difference between the
two runtimes; the page, the probes and the state machine are one copy.

Upgrading from an earlier version: [docs/UPGRADING.md](docs/UPGRADING.md).

Limits: on Workers the free tier allows 50 subrequests per invocation
(about 45 monitors; beyond that, split the cron) and probes run from
Cloudflare's edge. On a server the limit is the machine's, and one process
writes one SQLite file — which is why the Kubernetes manifests stay at one
replica. Days are counted in UTC either way.

## License

MIT. Icons from [Lucide](https://lucide.dev) (ISC).
