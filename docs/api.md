# API

Read-only, CORS-open and uncached: what you get is what is true at the
moment you asked. Every endpoint takes `?lang=` (`en`, `tr`, `de`, `es`,
`fr`).

| Endpoint | Returns |
|---|---|
| `/api/status.json` | overall state, per-monitor status, uptime, latency, recent events |
| `/api/history.json` | 90 days of daily totals per monitor |
| `/api/notices.json` | notices, markdown and rendered HTML |
| `/badge.svg` | the overall state as an SVG badge |
| `/feed.xml` | state changes and notices as RSS |
| `/llms.txt` | all of this in plain text, where agents look |
| `/health` | 204, with no database behind it |

## Without scraping the page

- Every response carries an `x-status` header — `up`, `sites`, `degraded`
  or `down`. A `HEAD /` is enough to read the overall state.
- `GET /` with `Accept: application/json` (and no `text/html`) returns the
  `status.json` body instead of HTML.
- A `Link` header on `/` points to `llms.txt`, the JSON and the feed; the
  HTML head carries the same as `<link rel="alternate">`.

## Reading status.json

`status` is one of four for the whole page: `up`; `sites` when only some
of the hosted sites are unreachable and everything else is serving;
`degraded` when a service is down; `down` when nothing answers.

Each monitor carries `status`, `uptime_90d` (percent, `null` before the
first day of data) and `latency_ms` from the most recent successful probe.
A grouped monitor says only how it is — how many hosts it speaks for is
not published.

## Notices

Writing needs `ADMIN_TOKEN`. On the page: press `n` (or open `/#notice`),
enter the token, write markdown, pick a severity and a language, publish.
Open notices show a resolve button in the same dialog.

```sh
curl -X POST https://status.example.com/api/notice \
  -H "authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d '{"severity": "maintenance", "lang": "all", "body": "Planned window 02:00-03:00 UTC."}'

curl -X POST https://status.example.com/api/notice/resolve \
  -H "authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d '{"id": 1}'
```

- `severity`: `info`, `maintenance`, `degraded`, `outage`.
- `lang`: one of the five languages, or `all` — a notice written for one
  language is served only to it.
- `body`: markdown, 1 to 4000 characters.

Guesses at the token are limited to ten a minute per address; a request
that turns out to be authorized does not count against them.
