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
| `fail_threshold` | `2` | consecutive failures before the monitor is called down |
| `group_name` | `NULL` | the heading it appears under |
| `grouped` | `0` | `1` shows it only inside its group's tally |
| `enabled` | `1` | `0` stops probing without losing the history |
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

A monitor with `grouped = 1` is never named on the page. Its group shows a
tally instead — "6/6 up" — and says how it is, not how many it speaks for:
degraded while some members are unreachable, down once half or more are.
For the sites you host but do not own; a public status page does not have
to be a public customer list.

## Turning one off

```sql
UPDATE monitors SET enabled = 0 WHERE slug = 'api';
```

The history stays. Deleting the row instead leaves its `checks`, `days`
and `events` behind with nothing to name them.
