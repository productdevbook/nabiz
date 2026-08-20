# Upgrading

**A self-hosted deployment upgrades by pulling the new image:**

```sh
docker compose pull && docker compose up -d          # with compose
docker pull ghcr.io/productdevbook/nabiz:latest      # with docker run
docker rm -f nabiz && docker run -d --name nabiz … ghcr.io/productdevbook/nabiz:latest
```

The `docker run` form needs every flag you first used typed again — the
volume, the port and the environment. The volume is what carries the
history; the environment is not stored anywhere, and a token you forget to
pass is a deployment that refuses every write.

It applies
`schema.sql` on start, which adds any missing table or index, and then adds
any missing column itself — printing what it added:

    [nabiz] added state.last_status

Nothing below has to be run by hand there. It is listed because a
Cloudflare deployment has no start to do it at: `wrangler d1 execute --file
schema.sql` adds tables and indexes and **cannot add a column to a table
that already exists**, so re-running it is not an upgrade. Run whichever of
these your D1 database is missing.

If you skip them, the deployment does not stop: it starts, `/health`
answers 204, and everything that reads the state — the page, `status.json`,
`history.json`, the feed, the badge — returns 500 with `no such column: …`
in the log, while `notices.json`, `llms.txt` and `robots.txt` carry on
answering. Each probe round writes its checks and then fails before the
state, so pruning and alerting stop too.

```sh
# v0.1 → v0.2
bunx wrangler d1 execute nabiz --remote --command "ALTER TABLE monitors ADD COLUMN expect_body TEXT"
bunx wrangler d1 execute nabiz --remote --command "CREATE TABLE events (monitor_id INTEGER NOT NULL, at INTEGER NOT NULL, ok INTEGER NOT NULL); CREATE INDEX events_by_time ON events (at)"

# v0.2 → v1.0
bunx wrangler d1 execute nabiz --remote --command "ALTER TABLE monitors ADD COLUMN fail_threshold INTEGER NOT NULL DEFAULT 2"
bunx wrangler d1 execute nabiz --remote --command "ALTER TABLE state ADD COLUMN fails INTEGER NOT NULL DEFAULT 0"

# v1.0 → v1.1
bunx wrangler d1 execute nabiz --remote --command "CREATE TABLE IF NOT EXISTS notices (id INTEGER PRIMARY KEY, at INTEGER NOT NULL, severity TEXT NOT NULL DEFAULT 'info', body_md TEXT NOT NULL, resolved_at INTEGER)"

# v1.1 → v2.0
bunx wrangler d1 execute nabiz --remote --command "ALTER TABLE notices ADD COLUMN lang TEXT"

# v3.0 → v3.1 — two indexes; nothing is rewritten, nothing is lost
bunx wrangler d1 execute nabiz --remote --command "CREATE INDEX IF NOT EXISTS checks_by_time ON checks (at, ok, monitor_id, ms)"
bunx wrangler d1 execute nabiz --remote --command "CREATE INDEX IF NOT EXISTS days_by_day ON days (day)"

# v3.3 → v3.4 — an index no query has used since the two above arrived.
# Optional: it costs a written row per probe and answers nothing.
bunx wrangler d1 execute nabiz --remote --command "DROP INDEX IF EXISTS checks_by_monitor"

# v3.4 → v3.5 — what the last probe answered, so a down row can say which
# kind of down it is
bunx wrangler d1 execute nabiz --remote --command "ALTER TABLE state ADD COLUMN last_status INTEGER"

# v3.6 → v3.7 — why a monitor is down, when the status code does not say it
bunx wrangler d1 execute nabiz --remote --command "ALTER TABLE state ADD COLUMN last_reason TEXT"

# v3.8 → v3.9 — which kind of monitor wrote an event, so the page can read a
# window of each without walking every event ever kept
bunx wrangler d1 execute nabiz --remote --command "ALTER TABLE events ADD COLUMN grouped INTEGER NOT NULL DEFAULT 0"
bunx wrangler d1 execute nabiz --remote --command "UPDATE events SET grouped = 1 WHERE monitor_id IN (SELECT id FROM monitors WHERE grouped <> 0)"
bunx wrangler d1 execute nabiz --remote --command "CREATE INDEX IF NOT EXISTS events_by_kind ON events (grouped, at)"
```

The three v3.9 statements are one change and go together: the column, the
value it should have had for the events already there, and the index that
makes the column worth having. Run in that order — the index over a column
that does not exist yet is an error, and this is why a container adds the
columns **before** it applies `schema.sql` rather than after.

## v3.7 → v3.8 reads bodies, and `expect_body` may need rewording

Before v3.8 a monitor with `expect_body` read the whole response; from
v3.8 it reads the first 64 KB and no more. A monitor whose words sit
below that — a footer, a version banner, anything late in a large page —
goes down at the first round after the upgrade, with an alert, and the
host it watches is fine. Check before you pull:

```sh
curl -s https://example.com/ | head -c 65536 | grep -c "the words you configured"
```

Zero means move the words earlier in the page or point the monitor at a
smaller endpoint. Nothing else about `expect_body` changed.

Two numbers changed meaning in v3.8 and back in v3.9. A monitor's latency
was time to the answer, became time to the answer plus its body while the
cap was being read, and is time to the answer again — so a 90-day history
that spans v3.8 has a step in it for any monitor serving a large page.
Nothing has to be done about it; the days already written are not rewritten.

Running them all against a database that is already current is safe — the
ones it has fail with `duplicate column name` and change nothing — but
there is no version stamp to read, so the tell is the column itself:
`PRAGMA table_info(state)` without `last_status` is older than v3.5.

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
bunx wrangler d1 export nabiz --remote --output nabiz.sql -y
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

The container applies `schema.sql` on every start and then adds any column
the export's schema predates, so an export taken from an older deployment
comes up complete — it says which columns it added.
