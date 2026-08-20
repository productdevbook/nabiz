# Upgrading

Schema additions land as `ALTER`s; run whichever your database is missing.

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

# v3.0 → v3.1 — two indexes; nothing is rewritten, nothing is lost
bunx wrangler d1 execute nabiz --remote --command "CREATE INDEX IF NOT EXISTS checks_by_time ON checks (at, ok, monitor_id, ms)"
bunx wrangler d1 execute nabiz --remote --command "CREATE INDEX IF NOT EXISTS days_by_day ON days (day)"

# v3.3 → v3.4 — an index no query has used since the two above arrived.
# Optional: it costs a written row per probe and answers nothing.
bunx wrangler d1 execute nabiz --remote --command "DROP INDEX IF EXISTS checks_by_monitor"
```

A self-hosted deployment needs none of these by hand: `schema.sql` is
applied on every start and each statement is `IF NOT EXISTS`.

v2.0 is the Astro rebuild: same worker, same schema plus the one column,
but deploying now runs `astro build` first — `bun run deploy` does both.

v3.0 adds the server runtime, the container and the Kubernetes manifests.
The schema does not change and neither does the Workers deployment:
`bun run deploy` is the same command it was. What is new sits beside it —
`bun run build:server`, a Dockerfile, `deploy/k8s`.

Moving a Workers deployment to a server is a copy of the data rather than
a migration of the schema. D1's export carries `CREATE TABLE` statements
without `IF NOT EXISTS`, so it has to land in a file that does not exist
yet — before the container's first start, not after it:

```sh
bunx wrangler d1 export nabiz --remote --output nabiz.sql
docker run --rm --user 1000:1000 -v nabiz:/data -v "$PWD":/in \
  ghcr.io/productdevbook/nabiz:latest bun -e '
  import { Database } from "bun:sqlite"
  import { readFileSync } from "node:fs"
  new Database("/data/nabiz.db").exec(readFileSync("/in/nabiz.sql", "utf8"))
'
```

The image and the user are nabiz's own on purpose: a volume first touched
by a root process is a volume the container cannot write, and the crash
that follows says only "attempt to write a readonly database".

The container applies `schema.sql` on every start, which is additive and
does nothing to tables the export already made.
