<p align="center">
  <img src="docs/cover.svg" alt="nabiz" width="100%">
</p>

[![CI](https://github.com/productdevbook/nabiz/actions/workflows/ci.yml/badge.svg)](https://github.com/productdevbook/nabiz/actions/workflows/ci.yml)
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/productdevbook/nabiz)

# nabiz

Self-hosted status page running as a single Cloudflare Worker: Astro
renders the page, a cron trigger runs the probes, D1 stores the history.
Fits in the free tier. *nabız* is Turkish for "pulse"; the ASCII spelling
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

Not included: incident timelines, subscriber emails, multi-region probes.
Docker/Kubernetes/server runtimes are planned — see the
[roadmap issues](https://github.com/productdevbook/nabiz/issues?q=label%3Aroadmap).

## Setup

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

## Configuration

| Where | Name | Purpose |
|---|---|---|
| `wrangler.toml` `[vars]` | `TITLE` | page title |
| `wrangler.toml` `[vars]` | `LANG` | default language (`en`, `tr`, `de`, `es`, `fr`) |
| `wrangler secret put` | `ADMIN_TOKEN` | enables notice writing; without it all writes are refused |
| `wrangler secret put` | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Telegram alerts (optional) |
| `wrangler secret put` | `ALERT_WEBHOOK_URL` | webhook alerts (optional) |

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
```

Upgrading from an earlier version: [docs/UPGRADING.md](docs/UPGRADING.md).

Limits: the free tier allows 50 subrequests per invocation (about 45
monitors; beyond that, split the cron). Probes run from Cloudflare's edge.
Days are counted in UTC.

## License

MIT. Icons from [Lucide](https://lucide.dev) (ISC).
