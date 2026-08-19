# Monitors

What is watched is rows in the database, never a file in this repository —
a monitor's URL is often somebody's hostname, and this repository is
public.

## The columns

From [`schema.sql`](../schema.sql):

| Column | Default | Meaning |
|---|---|---|
| `slug` | — | unique, short, yours |
| `name` | — | what the page calls it |
| `url` | — | what is fetched |
| `method` | `GET` | any HTTP method |
| `expect_status` | `200` | anything else is a failure; redirects are not followed |
| `timeout_ms` | `10000` | a probe that takes longer has failed |
| `expect_body` | `NULL` | when set, a 200 without these words is still a failure |
| `fail_threshold` | `2` | consecutive failures before a watched monitor is called down; the very first probe is believed at once, since there is no state to keep |
| `group_name` | `NULL` | the heading it appears under |
| `grouped` | `0` | `1` shows it only inside its group's tally |
| `enabled` | `1` | `0` removes it from the page and the API entirely |
| `position` | `0` | the order on the page |

## Adding them on Cloudflare

```sh
bunx wrangler d1 execute nabiz --remote --command "
  INSERT INTO monitors (slug, name, url, group_name, grouped, position) VALUES
    ('api',    'API',        'https://api.example.com/health', NULL,           0, 1),
    ('site-a', 'customer a', 'https://a.example',              'Hosted sites', 1, 10)
"
```

## Adding them in a container

The image has bun, so `bun:sqlite` is the way in; there is no `sqlite3`
binary in there.

```sh
docker exec nabiz bun -e '
  import { Database } from "bun:sqlite"
  new Database("/data/nabiz.db").run(
    "INSERT INTO monitors (slug, name, url, position) VALUES (?, ?, ?, ?)",
    ["api", "API", "https://api.example.com/health", 1],
  )
'
```

In a cluster the same command through `kubectl exec` — and the URL can be
one only the cluster can resolve, which is the point:
`http://api.default.svc.cluster.local/health`.

## Groups

A monitor with `grouped = 1` is never named on the page, in the API or in
the feed. Its group is one row that says how it is and nothing else:
degraded while some members are unreachable, down once half or more are.
Not how many members there are, not which — a public status page does not
have to be a public customer list.

A row with `grouped = 1` and no `group_name` is not a mistake the page
will publish its way out of: it joins a group shown as `—`. Give the group
a name and the row moves to it.

The group's ninety days and its uptime figure are the median member's, so
one site's bad afternoon is not billed to everyone else's history; a day
fewer than half the members have data for is not published at all.

## Turning one off

```sql
UPDATE monitors SET enabled = 0 WHERE slug = 'api';
```

The rows stay in the database, but a disabled monitor is gone from the
page, from `status.json`, from the history, the badge, the feed and the
events list — `monitors()` reads `WHERE enabled = 1` and everything is
built from that. Set it back to `1` and the whole history returns.

Deleting the row instead throws the history away: `monitors.id` is a
SQLite rowid, so the next monitor you insert can be handed the same id,
and the sweep that runs each hour is what stops it inheriting a stranger's
uptime. Disable rather than delete if you want the bars back later.
