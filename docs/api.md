# API

Read-only, CORS-open and uncached: what you get is what is true at the
moment you asked. Three of them answer in a language — `/`, `/feed.xml`
and `/api/notices.json` take `?lang=` (`en`, `tr`, `de`, `es`, `fr`); the
rest carry no words to translate.

| Endpoint | Returns |
|---|---|
| `/api/status.json` | overall state, per-monitor status, uptime, latency, recent events |
| `/api/history.json` | 90 days of daily totals per monitor |
| `/api/notices.json` | notices, markdown and rendered HTML |
| `/badge.svg` | the overall state as an SVG badge, always in English |
| `/feed.xml` | state changes and notices as RSS |
| `/llms.txt` | all of this in plain text, where agents look |
| `/health` | 204, with no database behind it |

## Without scraping the page

- `/` and `/api/status.json` carry an `x-status` header — `up`, `sites`,
  `degraded` or `down`. A `HEAD /` is enough to read the overall state.
- `GET /` with `Accept: application/json` (and no `text/html`) returns the
  `status.json` body instead of HTML.
- A `Link` header on the HTML `/` points to `llms.txt`, the JSON and the
  feed; the HTML head carries the same as `<link rel="alternate">`. The
  JSON answer to `/` carries `x-status` but not that header.

## Reading status.json

`updated_at` is when a probe last wrote anything, not when the response
was rendered — so a page whose probe loop has stopped, or whose disk is
full, goes stale in that field while everything else still answers. It is
`null` before the first probe. Watching it is how a machine tells a
working status page from a frozen one; `/health` cannot, by design.

`status` is one of four for the whole page: `up`; `sites` when only some
of the hosted sites are unreachable and everything else is serving;
`degraded` when a service is down; `down` when nothing answers.

Each monitor carries `status` — `up`, `degraded`, `down`, or `unknown`
before its first probe has written anything — `uptime_90d` (percent,
`null` before the first day of data) and `latency_ms` from the most recent
successful probe.

A group says only how it is; how many hosts it speaks for is not
published. Its `uptime_90d` and its days in `history.json` are the median
member's rather than a total, so one member's outage does not become
everyone's history — and a day fewer than half the members have data for
is left out rather than guessed at.

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

Guesses at the token are limited to ten a minute per address, and a
refusal carries `retry-after: 60`. A request that turns out to be
authorized clears the count — but the limit is checked before the token
is, so once it has tripped even the right token waits out the window.
