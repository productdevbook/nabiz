# On a machine you own

One process: the same Astro page, an interval where the Workers cron was,
and a SQLite file where D1 was. Probes leave from wherever it runs — the
reason to run it inside a network no edge can reach.

## Docker

```sh
docker run -d --name nabiz -p 8080:8080 -v nabiz:/data \
  -e NABIZ_TITLE="status" -e NABIZ_LANG=en -e ADMIN_TOKEN=… \
  ghcr.io/productdevbook/nabiz:latest
```

Images are published for `linux/amd64` and `linux/arm64` on every release.
Pin a version tag (`:3.0.1`) for anything you rely on.

Nothing is configured in the image: an empty volume boots to an empty,
working page, and monitors are rows you add afterwards — see
[Monitors](monitors.md).

## Compose

[`compose.yaml`](../compose.yaml) is the same thing with a named volume:

```sh
ADMIN_TOKEN=… docker compose up -d
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

The database is `NABIZ_DB` (`/data/nabiz.db` by default) and the schema is
applied on start, so a path that does not exist yet becomes a working page.

## What the container promises

- Port 8080, `PORT` and `HOST` to change it.
- `/health` returns 204 and touches no database — the healthcheck and the
  Kubernetes probes both use it.
- One process, no host cron, no sidecar: the probe loop runs inside it on
  `NABIZ_INTERVAL_MS` (60000).
- It runs as an unprivileged user and works with a read-only root
  filesystem; `/data` is the only path it needs to write.
- The database and its write-ahead log are created `0600`.

## Backups

Let SQLite do the copying — `cp` on a live database can catch it mid-write:

```sh
docker exec nabiz bun -e "
  import { Database } from 'bun:sqlite'
  new Database('/data/nabiz.db').run(\"VACUUM INTO '/tmp/nabiz-backup.db'\")
"
docker cp nabiz:/tmp/nabiz-backup.db ./nabiz-backup.db
```

## Behind a proxy

Set `TRUST_PROXY` to the number of proxies in front of it — but only when
the port cannot be reached around them. See
[Configuration](configuration.md#trust_proxy).
