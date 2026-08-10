<p align="center">
  <img src="docs/cover.svg" alt="nabiz — a status page that keeps beating when your server does not" width="100%">
</p>

[![CI](https://github.com/productdevbook/nabiz/actions/workflows/ci.yml/badge.svg)](https://github.com/productdevbook/nabiz/actions/workflows/ci.yml)
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/productdevbook/nabiz)

# nabiz

*From the Turkish **nabız** — "pulse", as in keeping a finger on one.
Spelled `nabiz` everywhere, because the dotless ı deserves better than
being typed wrong.*

A status page that keeps beating when your server does not. One Cloudflare
Worker probes your endpoints every minute from Cloudflare's edge, keeps the
history in D1, and serves the page itself — so when the machine it watches
goes dark, the page saying so stays up. Fits entirely inside Cloudflare's
free tier.

The page is Astro rendering on the same Worker; the probing is a cron on
it. One deployment, two duties.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshot-dark.png">
  <img src="docs/screenshot-light.png" alt="the status page: uptime bars, vital chips, notices, events" width="100%">
</picture>

## What it does

- Probes every monitor once a minute; expected status, timeout, method and
  optional **body matching** per monitor — when `expect_body` is set, a 200
  with the wrong words in it is still a failure, because a database error
  page and a healthy page can share a status code.
- **One bad minute is weather, not an outage**: a monitor is called down
  only after `fail_threshold` probes in a row fail (default 2), while
  recovery is immediate. The bars still draw every measurement — the
  record and the verdict are different things.
- Ninety days of uptime per monitor as day bars, and a **vital chip** next
  to each name: the last day of latency as a little waveform with its
  current reading, in the color of the monitor's state.
- **Grouped monitors**: hosts you serve but do not own are shown only as a
  tally — "6/6 up" — never by name. A public status page does not have to
  be a public customer list.
- **Operator notices**: press `n` on the page, give the access token, and
  write what is happening in markdown — severity chips, per-language
  notices, one-click resolve, the same over the API for scripts. A probe
  can say that a thing is down; only a person can say why.
- A **Recent events** list — every change of state, kept for half a year —
  and a Telegram message and/or webhook on each change, with how long the
  previous state had held.
- English, Turkish, German, Spanish and French out of the box (`?lang=`,
  default from the `LANG` var).
- Light and dark, chosen by the visitor or the OS; the page refreshes
  itself in place every 25 seconds.
- **An API, an RSS feed, a badge and an `llms.txt`** — the readers of a
  status page are no longer only people.

## What it deliberately does not do

Incident timelines, subscriber emails, multi-region probes: that is what
the paid status products are for, and if you need them, buy one. This is
the other end of the trade — a single file of SQL away from understood,
running where the outage cannot reach it, for nothing.

## Setup

```sh
git clone https://github.com/productdevbook/nabiz && cd nabiz
bun install
bunx wrangler d1 create nabiz                        # put the id into wrangler.toml
bunx wrangler d1 execute nabiz --remote --file schema.sql
bun run deploy                                       # astro build + wrangler deploy
```

Then tell it what to watch — monitors are rows, not config, because this
repository is public and your hostnames are yours:

```sql
INSERT INTO monitors (slug, name, url, group_name, grouped, position) VALUES
  ('api',    'API',        'https://api.example.com/health', NULL, 0, 1),
  ('site-a', 'customer a', 'https://a.example',  'Hosted sites', 1, 10),
  ('site-b', 'customer b', 'https://b.example',  'Hosted sites', 1, 11);
```

```sh
bunx wrangler d1 execute nabiz --remote --command "INSERT INTO monitors …"
```

Set the page's words in `wrangler.toml` (`TITLE`, `LANG`), and the secrets
you want:

```sh
bunx wrangler secret put ADMIN_TOKEN          # enables notices; without it, nothing writes
bunx wrangler secret put TELEGRAM_BOT_TOKEN   # optional, for alerts
bunx wrangler secret put TELEGRAM_CHAT_ID
bunx wrangler secret put ALERT_WEBHOOK_URL
```

To serve it on your own hostname, uncomment the `routes` line in
`wrangler.toml` — Cloudflare creates the DNS record and the certificate.

## The API

Everything the page knows, as JSON — read-only, CORS-open, uncached:

| Endpoint | What it answers |
|---|---|
| `/api/status.json` | overall state, per-monitor status, 90-day uptime, latency, recent events |
| `/api/history.json` | ninety days of daily totals and average latency per monitor |
| `/api/notices.json` | operator notices, markdown and rendered |
| `/badge.svg` | the overall state as a badge, for a readme |
| `/feed.xml` | every change of state and every notice, as RSS |
| `/llms.txt` | all of this, in the shape agents look for |
| `/robots.txt` | everyone is welcome; machines are pointed at llms.txt |
| `/health` | 204 — the status page's own pulse, with no database behind it |

Every read endpoint takes `?lang=` (en, tr, de, es, fr). Writing needs the
token and goes over `Authorization: Bearer`:

```sh
curl -X POST https://status.example.com/api/notice \
  -H "authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d '{"severity": "maintenance", "lang": "all", "body": "**Planned window** tonight, 02:00-03:00 UTC."}'
curl -X POST https://status.example.com/api/notice/resolve \
  -H "authorization: Bearer $TOKEN" -H "content-type: application/json" -d '{"id": 1}'
```

Grouped monitors keep their anonymity in the API too: a tally, never a
member list.

## For machines

The page answers to the shape of the request, so an agent never has to
scrape HTML:

- **`HEAD /` is enough**: every page and JSON response carries an
  `x-status` header — `up`, `degraded` or `down` — so the cheapest
  possible request already answers the only question.
- **`GET /` with `Accept: application/json`** (and no `text/html`) returns
  the `status.json` body instead of the page.
- A **`Link` header** on `/` points to `llms.txt`, the JSON and the RSS
  feed; the HTML head carries the same as `<link rel="alternate">`.
- **`/llms.txt`** explains all of it in prose, at the address agents
  already look.

## Development

```sh
bun run dev          # Astro dev server with a local D1 (miniflare)
bunx wrangler d1 execute nabiz --local --file schema.sql   # once, to create it
bun run check        # typecheck + lint + format + tests, what CI runs
```

## Upgrading from earlier versions

Schema additions land as `ALTER`s; run whichever your database is missing:

```sh
# v0.1 → v0.2
bunx wrangler d1 execute nabiz --remote --command "ALTER TABLE monitors ADD COLUMN expect_body TEXT"
bunx wrangler d1 execute nabiz --remote --command "CREATE TABLE events (monitor_id INTEGER NOT NULL, at INTEGER NOT NULL, ok INTEGER NOT NULL); CREATE INDEX events_by_time ON events (at)"
# v0.2 → v1.0
bunx wrangler d1 execute nabiz --remote --command "ALTER TABLE monitors ADD COLUMN fail_threshold INTEGER NOT NULL DEFAULT 2"
bunx wrangler d1 execute nabiz --remote --command "ALTER TABLE state ADD COLUMN fails INTEGER NOT NULL DEFAULT 0"
# v1.0 → v1.1
bunx wrangler d1 execute nabiz --remote --command "CREATE TABLE notices (id INTEGER PRIMARY KEY, at INTEGER NOT NULL, severity TEXT NOT NULL DEFAULT 'info', body_md TEXT NOT NULL, resolved_at INTEGER)"
# v1.1 → v2.0
bunx wrangler d1 execute nabiz --remote --command "ALTER TABLE notices ADD COLUMN lang TEXT"
```

v2.0 is the Astro rebuild: same worker, same schema plus the one column,
but deploying now runs `astro build` first — `bun run deploy` does both.

## Limits worth knowing

- The free tier allows 50 subrequests per invocation: keep it under ~45
  monitors, or split the cron.
- Probes come from Cloudflare's edge. If the target is behind Cloudflare
  too, you are measuring edge-to-origin — still an honest availability
  check, not a full user path.
- Days are counted in UTC.

## License

MIT. The icons are [Lucide](https://lucide.dev), ISC.
