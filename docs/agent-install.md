# Installing nabiz with an agent

A runbook for an assistant doing the install on somebody's behalf: exact
commands, what a working result looks like, and what each failure means.
The reference pages are [self-hosting](self-hosting.md),
[cloudflare](cloudflare.md), [monitors](monitors.md) and
[configuration](configuration.md) — this page does not repeat them, it
sequences them.

## Ask first, install second

Three answers decide everything else:

1. **Where** — a machine the operator owns (Docker, compose, Kubernetes),
   or Cloudflare Workers. If what they want watched is behind a firewall
   or inside a cluster, it has to be the first. If they want the page to
   survive their own machine going down, it has to be the second. Both is
   a legitimate answer.
2. **Title and language** — `NABIZ_TITLE`, and one of `en`, `tr`, `de`,
   `es`, `fr`.
3. **A token, or not** — `ADMIN_TOKEN` enables writing notices. Without
   it every write is refused, which is a working state; do not invent one
   and do not put it in a file you commit.

Never ask for, echo, or write down the URLs they want watched in anything
that goes into a repository. They are rows in a database for that reason.

## Install: a container

```sh
docker run -d --name nabiz -p 8080:8080 -v nabiz:/data \
  -e NABIZ_TITLE="status" -e NABIZ_LANG=en \
  ghcr.io/productdevbook/nabiz:latest
```

Add `-e ADMIN_TOKEN=…` if they gave you one. Pin a version tag for
anything they rely on. Then verify — all four must hold:

```sh
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8080/health   # 204
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8080/         # 200
curl -sI http://127.0.0.1:8080/ | grep -i x-status                      # up
curl -s http://127.0.0.1:8080/api/status.json | head -3                 # json
docker logs nabiz                                                       # one line: listening
```

An empty page with no monitors is the correct result of an install.

## Install: Cloudflare

The account steps need the operator's browser — `wrangler login` and
creating the D1 database cannot be done for them silently.

```sh
git clone https://github.com/productdevbook/nabiz && cd nabiz && bun install
bunx wrangler d1 create nabiz            # copy the id into wrangler.toml
bunx wrangler d1 execute nabiz --remote --file schema.sql
bun run deploy
```

`database_id` in `wrangler.toml` is the only file edit. Secrets go in with
`bunx wrangler secret put ADMIN_TOKEN`, never into the file.

## Add what is watched

One row per monitor. In a container:

```sh
docker exec nabiz bun -e '
  import { Database } from "bun:sqlite"
  new Database("/data/nabiz.db").run(
    "INSERT INTO monitors (slug, name, url, position) VALUES (?, ?, ?, ?)",
    ["api", "API", "https://api.example.com/health", 1],
  )
'
```

On Cloudflare, the same INSERT through
`bunx wrangler d1 execute nabiz --remote --command "…"`.

Then wait one probe interval (60s by default) and read
`/api/status.json`: the monitor should be there with a `status` and a
`latency_ms`. A monitor that stays `down` when the operator says the
service is up is usually `expect_status` (redirects are not followed) or a
timeout — not a broken install.

## When something is wrong

| What you see | What it means | What to do |
|---|---|---|
| `attempt to write a readonly database` | the volume or file is owned by another user — usually a `docker run` that touched it as root | run such commands with `--user 1000:1000`, or `chown -R 1000:1000` the volume |
| `[nabiz] no built site at …` | running from a checkout without building | `bun run build:server` |
| `… did not load — if the last build was bun run build` | `dist/` holds the Worker build, not the server one | `bun run build:server` |
| `Cross-site POST form submissions are forbidden` | a POST without `content-type: application/json` | send the header |
| `{"error":"unauthorized"}` | `ADMIN_TOKEN` is unset in the deployment, or the token is wrong | set it and restart; a token set after the container started is not in it |
| `{"error":"too many attempts"}` | ten requests in a minute from one address | wait out the window; the limit is checked before the token, so the right one is refused too until it passes |
| `[nabiz] the probe round failed: …` | the round threw — read the rest of the line, it names the cause (a full disk says so) | fix what it names; the page keeps serving meanwhile |
| the page renders but no monitors | no rows, or `enabled = 0` | add rows |
| every monitor is down at once | the machine cannot reach anything — DNS or egress, not nabiz | check from the same host with curl |
| the latency chip is missing | no successful probe in the last hour | wait an interval; check the monitor is up |

## Do not

- Do not put monitor URLs, tokens or chat ids into any file in a
  repository, including examples in a commit message.
- Do not raise the replica count in Kubernetes: one SQLite file, one
  writer. See [deploy/k8s](../deploy/k8s/README.md).
- Do not set `TRUST_PROXY` unless the port cannot be reached around the
  proxy — it decides which address the token throttle counts by.
- Do not add a host cron or a CronJob. The probe loop is in the process.
- Do not edit `schema.sql` to change a deployment; it is applied additively
  on every start.
