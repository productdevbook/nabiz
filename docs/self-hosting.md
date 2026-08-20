# On a machine you own

One process: the same Astro page, an interval where the Workers cron was,
and a SQLite file where D1 was. Probes leave from wherever it runs — the
reason to run it inside a network no edge can reach.

## Docker

```sh
docker run -d --name nabiz -p 8080:8080 -v nabiz:/data \
  -e NABIZ_TITLE="status" -e NABIZ_LANG=en \
  -e ADMIN_TOKEN="$(openssl rand -hex 32)" \
  ghcr.io/productdevbook/nabiz:latest
```

Images are published for `linux/amd64` and `linux/arm64` on every release,
tagged `:latest`, the major (`:3`), the minor and the full version. Pin at least the major for
anything you rely on; pin the full version if you would rather decide when
to move. Note that the documentation on GitHub tracks `main`, so it can be
ahead of the image you are running.

Nothing is configured in the image: an empty volume boots to an empty,
working page, and monitors are rows you add afterwards — see
[Monitors](monitors.md).

## Compose

[`compose.yaml`](../compose.yaml) is the same thing with a named volume.
Put the token in a `.env` file beside it rather than on the command line —
compose reads the environment fresh on every `up`, so a token given once
on a command line is gone the next time you upgrade, and every write is
refused from then on with no other symptom:

```sh
echo "ADMIN_TOKEN=$(openssl rand -hex 32)" > .env
docker compose up -d
```

## Kubernetes

[`deploy/k8s`](../deploy/k8s/README.md) — a Deployment, a PVC, a Service,
an Ingress and a kustomization. One replica by design.

## From a checkout

With bun, or Node 24 and later:

```sh
bun install
bun run build:server     # astro build for the server target
bun run start            # or: node src/server/index.ts
```

The database is `NABIZ_DB` — `./nabiz.db` beside the checkout by default,
`/data/nabiz.db` in the image. The schema is applied on start, so a file
that does not exist yet becomes a working page; the directory around it
has to exist already.

## Under load

The page and the API are held in the process for fifteen seconds **or
until the next write, whichever comes first** — and every probe round is a
write, so what is served is never older than the round behind it whatever
`NABIZ_INTERVAL_MS` is set to. A notice you publish is on the page when it
reloads, for the same reason.

Measured on forty monitors with ninety days of history, fifty concurrent
readers: about 320 requests a second for the HTML and 3,500 for
`status.json`, holding at about 115 MB at rest and 200 MB at the peak of a
burst. The probe round keeps its cadence throughout — reading the page
does not slow down the watching.

## What the container promises

- Port 8080, `PORT` and `HOST` to change it.
- `/health` returns 204 and touches no database — the healthcheck and the
  Kubernetes probes both use it.
- One process, no host cron, no sidecar: the probe loop runs inside it on
  `NABIZ_INTERVAL_MS` (60000).
- It runs as an unprivileged user and works with a read-only root
  filesystem; `/data` is the only path it needs to write.
- The database and its write-ahead log are `0600`, including one that
  arrived from a backup or a D1 export — the file is narrowed before it is
  opened, because SQLite copies its mode onto the log it creates beside it.
- `/health` answers as long as the process does. It cannot see a database
  that has stopped accepting writes: for that, read `updated_at` in
  `/api/status.json`, which is when a probe last wrote rather than when the
  page rendered.

## Backups

Let SQLite do the copying — `cp` on a live database can catch it mid-write:

```sh
docker exec nabiz bun -e "
  import { Database } from 'bun:sqlite'
  new Database('/data/nabiz.db').run(\"VACUUM INTO '/tmp/nabiz-backup.db'\")
"
docker cp nabiz:/tmp/nabiz-backup.db ./nabiz-backup.db
chmod 600 nabiz-backup.db
```

That last line is not decoration: the live database is `0600` because it
holds the URLs of everything you watch, and a copy of it on your laptop
holds them too.

## Restoring one

The backup is a database file, so restoring it is putting that file where
nabiz looks — into a volume that does not have one yet, before the first
start. Use nabiz's own image and user: a fresh named volume belongs to
root until an image that owns `/data` mounts it, and a file written by
anybody else is a file the container cannot open.

```sh
docker run --rm --user 1000:1000 -v nabiz:/data -v "$PWD":/in \
  ghcr.io/productdevbook/nabiz:latest \
  cp /in/nabiz-backup.db /data/nabiz.db
docker start nabiz
```

The schema is applied on start, so a backup from an older version comes up
with whatever the new one adds. Delete the copy you took out of the
container afterwards — it carries the URLs of everything you watch.

## Behind a proxy

Set `TRUST_PROXY` to the number of proxies in front of it — but only when
the port cannot be reached around them. See
[Configuration](configuration.md#trust_proxy).
