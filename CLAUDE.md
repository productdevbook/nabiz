# Working on nabız

This repository is public. Everything in it — code, comments, commit
messages — is readable by anyone, forever.

## Nothing about whoever is running it

The reason monitors are rows in D1 rather than entries in a config file is
that a monitor's URL is usually somebody's hostname. Keep it that way:

- **No real hostnames** in code, comments, tests, examples or commit
  messages — not the operator's, not their customers'. `example.com` and
  invented names only.
- **No tokens or IDs** that belong to a deployment: D1 database ids, chat
  ids, webhook addresses. The `wrangler.toml` here carries placeholders;
  a real deployment keeps its filled-in copy somewhere private.

## Everything else

- `bun run typecheck` before every commit; there is no build step to catch
  what it does not.
- The worker must stay inside Cloudflare's free tier: one cron a minute,
  no dependency that needs bundler configuration, no external service a
  probe depends on. A status page with a bill attached is a different
  product.
- Comments explain what the code cannot: a constraint that reads as wrong,
  an external behaviour nobody would guess, the reason a choice was made.
- Commit messages say why, in prose. What changed is in the diff.
