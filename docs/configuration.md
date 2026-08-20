# Configuration

On Cloudflare these are `[vars]` in `wrangler.toml` and secrets set with
`wrangler secret put`. On a server they are environment variables.

| Worker | Server | Purpose |
|---|---|---|
| `TITLE` | `NABIZ_TITLE` | page title |
| `LANG` | `NABIZ_LANG` | default language: `en`, `tr`, `de`, `es`, `fr` |
| `ADMIN_TOKEN` | `ADMIN_TOKEN` | enables notice writing; without it every write is refused |
| `TELEGRAM_BOT_TOKEN` | same | with the chat id, a message on every state change |
| `TELEGRAM_CHAT_ID` | same | |
| `ALERT_WEBHOOK_URL` | same | the same change as JSON, to an endpoint of yours |

## Server only

| Name | Default | Purpose |
|---|---|---|
| `PORT` | `8080` | |
| `HOST` | `0.0.0.0` | |
| `NABIZ_DB` | `./nabiz.db`, and `/data/nabiz.db` in the image | the SQLite file; the schema is applied on start |
| `NABIZ_INTERVAL_MS` | `60000` | how often the probe round runs — raw checks are kept two days, so halving this doubles the rows kept: about 20,000 per monitor at the default, 600,000 at two seconds |
| `NABIZ_DIST` | next to the source | where the built site is |
| `NABIZ_SCHEMA` | `schema.sql` beside it | the schema applied on start |
| `TRUST_PROXY` | off | see below |

A value that is not a number falls back to the default rather than
through: a `PORT` of `later` is 8080, not a random port.

`LANG` is a POSIX variable before it is nabiz's, so on a server
`NABIZ_LANG` wins and a `LANG` that is not one of the five languages is
ignored. `TITLE` has no such conflict and is read on a server too, with
`NABIZ_TITLE` winning — worth knowing if an env file already has one.

## TRUST_PROXY

The number of proxies in front that write `x-forwarded-for` — `1` for the
usual single reverse proxy or ingress. The notice endpoint counts guesses
at the token by address; without this every request behind a proxy looks
like the proxy, and all of them share one brake.

Set it **only when the port cannot be reached except through that proxy**.
Nothing in a request says which way it arrived, so anything that can open
a connection directly can hand you whatever address it likes and never
meet the ten-a-minute limit. In a cluster that means a NetworkPolicy —
[`deploy/k8s/networkpolicy.yaml`](../deploy/k8s/networkpolicy.yaml) is
there for exactly this; with Docker it means not publishing the port
alongside the proxy.

Anything that is not a count is off: unset, `0`, `no`, `off`, `false`.
`true`, `yes` and `on` mean one proxy.

## Alerts

Both are optional and best-effort — a paging channel that is down must not
take the probing down with it. A message is sent when a monitor changes
state, not for every minute of an outage, and recovery says how long the
outage held. One request per round per channel, however many monitors
changed.

The webhook receives:

```json
{
  "at": "2026-08-20T04:42:49.405Z",
  "text": "🔴 API — down",
  "changes": [
    { "slug": "api", "name": "API", "group": null, "ok": false, "held_for": null }
  ]
}
```

`held_for` is seconds and is present on a recovery. **`name` is the
monitor's own name, even for a grouped one** — the page never publishes
those, and this channel does, because an alert that said only "Hosted
sites" would not tell you which of forty sites to look at. `group` says
which group it belongs to so a consumer can decide what to repeat. Point
`ALERT_WEBHOOK_URL` somewhere private for the same reason.

A redirect is not a delivery: the webhook is called with redirects
refused, and a 3xx is logged as a refusal. Following one would turn the
POST into a bodyless GET that answers 200, which is an alert lost in
silence. Both channels are given a quarter of the round's time and no
more.

Nothing outside the log records a refused alert. `[nabiz] the webhook
refused the alert with 500` and the line after it, naming what nobody was
told, are the only trace.
