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
```

v2.0 is the Astro rebuild: same worker, same schema plus the one column,
but deploying now runs `astro build` first — `bun run deploy` does both.
