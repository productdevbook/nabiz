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

On start it adds any missing column first — printing what it added — and
then applies `schema.sql`, which creates any missing table and index. That
order is deliberate: the file carries indexes over columns the first step
adds, and an index over a column that does not exist yet is an error.

    [nabiz] added state.last_status

Nothing below has to be run by hand there. It is listed because a
Cloudflare deployment has no start to do it at: `wrangler d1 execute --file
schema.sql` adds tables and indexes and **cannot add a column to a table
that already exists**, so re-running it is not an upgrade. Run whichever of
these your D1 database is missing — and run them **before** you re-apply
`schema.sql`, not after, which is the order a container uses.

`wrangler d1 execute --file` is all-or-nothing: a file whose third
statement fails leaves the first two undone as well. So re-applying
`schema.sql` to a database missing a column below does not half-apply it —
it does nothing at all, and says so. (`bun:sqlite`, which is what a
container uses, stops at the failure and keeps what ran before it. That is
why the file puts every index after every table.)

If you skip them, the deployment does not stop, and that is the trouble:
it starts, `/health` answers 204 **with the new version in `x-nabiz`**, and
what breaks is whatever reads the missing column — for the v3.5 and v3.7
ones that is the page, `status.json`, `history.json`, the feed and the
badge; for the v3.9 one it is the page, `status.json` and the feed, while
`history.json` and the badge answer as if nothing were wrong. Each returns
500 with `no such column: …`
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

# v3.11 → v3.12 — when a run of failures began, so a recovery message can
# count the outage from the probe that failed rather than from the round
# that admitted it
bunx wrangler d1 execute nabiz --remote --command "ALTER TABLE state ADD COLUMN fail_at INTEGER"

# v3.9 → v3.10 — the index the hourly sweep uses to keep the column below
# true when a monitor is moved into a group or out of one
bunx wrangler d1 execute nabiz --remote --command "CREATE INDEX IF NOT EXISTS events_by_monitor ON events (monitor_id, grouped)"

# v3.8 → v3.9 — which kind of monitor wrote an event, so the page can read a
# window of each without walking every event ever kept
bunx wrangler d1 execute nabiz --remote --command "ALTER TABLE events ADD COLUMN grouped INTEGER NOT NULL DEFAULT 0"
bunx wrangler d1 execute nabiz --remote --command "UPDATE events SET grouped = 1 WHERE monitor_id IN (SELECT id FROM monitors WHERE grouped <> 0)"
bunx wrangler d1 execute nabiz --remote --command "CREATE INDEX IF NOT EXISTS events_by_kind ON events (grouped, at)"
```

The three v3.9 statements are one change and go together: the column, the
value it should have had for the events already there, and the index that
makes the column worth having. Run in that order — the index over a column
that does not exist yet is an error.

If you run the first and not the second, the hourly sweep repairs it from
v3.10 on: the column is a copy of `monitors.grouped`, and every sweep sets
it back to what that column says. That is also what makes it safe to edit
`monitors.grouped` afterwards, and what makes the `UPDATE` above safe to
re-run — it converges on the same answer the page labels rows with.

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
smaller endpoint.

v3.9 tightened the same cut. v3.8 read the first 64 KB *and the rest of
whatever chunk it was in* — up to 112 KB on Node, 69 KB on a Worker — so a
monitor whose words sit just past 64 KB could have been green on v3.8 and
goes red on v3.9. The check above is the same one; run it against 65536
bytes and believe that number rather than what v3.8 happened to read.

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
