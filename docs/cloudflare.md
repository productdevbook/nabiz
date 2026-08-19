# On Cloudflare

One Worker does everything: Astro renders the page on it, a cron trigger
runs the probes from it, D1 keeps the history. It fits in the free tier.

## Deploy

```sh
git clone https://github.com/productdevbook/nabiz && cd nabiz
bun install
bunx wrangler d1 create nabiz                        # put the id into wrangler.toml
bunx wrangler d1 execute nabiz --remote --file schema.sql
bun run deploy                                       # astro build + wrangler deploy
```

`bun run deploy` builds first and deploys `dist/server/wrangler.json`; the
`wrangler.toml` in the repository is the source of the settings that end up
there.

## Your own hostname

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

- The free tier allows 50 subrequests per invocation — about 45 monitors.
  Beyond that, split the cron.
- Probes leave from Cloudflare's edge, so anything behind a firewall is
  unreachable from here. That is what [self-hosting](self-hosting.md) is
  for, and the two deployments are complementary: one watches the network
  from outside, the other from inside.
- Days are counted in UTC.
- The page is held at the edge for less than a probe interval, so nothing
  served from cache is staler than the data behind it.
