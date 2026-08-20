# On Cloudflare

One Worker does everything: Astro renders the page on it, a cron trigger
runs the probes from it, D1 keeps the history. It fits in the free tier.

## Deploy

```sh
git clone https://github.com/productdevbook/nabiz && cd nabiz
bun install
bunx wrangler d1 create nabiz
```

That last command prints a `database_id`. **Put it into `wrangler.toml`
before going on** — the two commands below read it from there:

```sh
bunx wrangler d1 execute nabiz --remote --file schema.sql
bun run deploy                                       # astro build + wrangler deploy
```

`bun run deploy` builds first and deploys `dist/server/wrangler.json`; the
`wrangler.toml` in the repository is the source of the settings that end up
there.

## Your own hostname

Not only for the address: **the edge cache does not work on a
`workers.dev` deployment**, and the page relies on it to stay up when a
crowd arrives at once. Cloudflare's cache is a no-op there, and the two
calls it makes still count against the fifty. Give it a route.

Uncomment `routes` in `wrangler.toml` and let Cloudflare make the DNS:

```toml
routes = [{ pattern = "status.example.com", custom_domain = true }]
```

## Settings and secrets

`TITLE` and `LANG` are `[vars]` in `wrangler.toml`. The rest are secrets:

```sh
bunx wrangler secret put ADMIN_TOKEN
bunx wrangler secret put TELEGRAM_BOT_TOKEN
```

Every name and what it does: [Configuration](configuration.md).

## Limits

- The free tier allows 50 subrequests per invocation, and a probe, a
  database call and a cache call all count as one. A quiet round costs the
  number of monitors plus four — one to read the monitors and three to
  write the round; a round with a state change, both alert
  channels and the hourly sweep costs plus seven. That puts the ceiling at
  **43 monitors**; beyond it, split the cron. What failure looks like is
  worth knowing: the alert is the last thing in the round, so the first
  thing to be refused is the message telling you about the outage.
- Probes leave from Cloudflare's edge, so anything behind a firewall is
  unreachable from here. That is what [self-hosting](self-hosting.md) is
  for, and the two deployments are complementary: one watches the network
  from outside, the other from inside.
- Days are counted in UTC.
- The page is held at the edge for less than a probe interval, so nothing
  served from cache is staler than the data behind it.
