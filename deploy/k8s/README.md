# nabiz in a cluster

Plain manifests for the container image: a Deployment of one replica, a
PVC for the SQLite file, a Service, an Ingress. No Helm, no operator, no
CRDs — monitors are rows in the database, as everywhere else nabiz runs.

The point of running it here is the targets a public probe cannot reach:
a monitor URL like `http://api.default.svc.cluster.local/health` is an
ordinary row.

## Apply

```sh
kubectl apply -k deploy/k8s
```

Before that, edit two things:

- `ingress.yaml` — the host (`status.example.com`), the ingress class and,
  if TLS is issued by cert-manager, the annotation left commented there.
- `deployment.yaml` — `NABIZ_TITLE`, `NABIZ_LANG` (`en`, `tr`, `de`, `es`,
  `fr`), and the image tag. `:latest` is fine to try; pin a released tag
  for anything you rely on, either on the image line or through the
  `images:` entry in `kustomization.yaml`.

`pvc.yaml` asks for 1Gi from the default storage class. A year of history
for a few dozen monitors is a handful of megabytes; the size is there to
be larger than any default minimum, not because the data needs it.

## The secret

`secret.example.yaml` is not applied by the kustomization — copy it, fill
it in, apply it yourself:

```sh
cp deploy/k8s/secret.example.yaml deploy/k8s/secret.yaml   # then edit
kubectl apply -f deploy/k8s/secret.yaml
```

| Key | Purpose |
|---|---|
| `ADMIN_TOKEN` | enables notice writing; without it every write is refused |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Telegram alerts (optional) |
| `ALERT_WEBHOOK_URL` | webhook alerts (optional) |

The Deployment reads the secret with `optional: true`, so the pod starts
without it — a status page with no token is a status page nobody can
write notices on, which is a working state.

## Seeding monitors

Monitors are rows, not config. The process creates the schema on start,
so a fresh volume comes up as an empty, working page; you add rows to the
file inside the pod. The image has bun, so use `bun:sqlite` — there is no
`sqlite3` binary in there:

```sh
kubectl -n nabiz exec deploy/nabiz -- bun -e '
  import { Database } from "bun:sqlite"
  const db = new Database("/data/nabiz.db")
  db.run(
    "INSERT INTO monitors (slug, name, url, group_name, grouped, position) VALUES (?, ?, ?, ?, ?, ?)",
    ["api", "API", "http://api.default.svc.cluster.local/health", null, 0, 1],
  )
'
```

To read back what is there:

```sh
kubectl -n nabiz exec deploy/nabiz -- bun -e '
  import { Database } from "bun:sqlite"
  console.log(new Database("/data/nabiz.db").query("SELECT id, slug, url, enabled FROM monitors ORDER BY position").all())
'
```

Columns and defaults are in [`schema.sql`](../../schema.sql): `method`,
`expect_status`, `timeout_ms`, `expect_body`, `fail_threshold`, and
`grouped`, which shows a monitor only inside its group's tally.

## One replica, and why it stays that way

The store is one SQLite file on one volume. `replicas: 1` and
`strategy: Recreate` are the whole design: Recreate stops the old pod
before the new one starts, so an update never has two processes writing
the same file. Raising the replica count gives you two probe loops on one
database — every monitor checked twice a minute, writes queued behind each
other's locks, and on network storage, where SQLite's locking is not
dependable, a file that can end up corrupt. It scales nothing.

The part you notice first is not the doubled probes. Two loops racing over
one `state` table turn a flapping monitor into phantom flaps: measured on
a local volume, five real outage-and-recovery cycles produced twenty
webhook messages and twenty-two rows in `events`, including a "down" alert
three hundred milliseconds after the "recovered" for an outage that had
already ended. The page then shows an outage that never happened, and
somebody is woken for it.

A status page does not need horizontal scale — a rollout or a node drain
costs a few seconds of downtime on the page, and the probe history it
misses is the gap you would see on any restart. If that matters, put the
public deployment on Cloudflare Workers and let this one watch the
cluster from inside.

## Backups

Let SQLite do the copying — `cp` on a live database can catch it
mid-write:

```sh
kubectl -n nabiz exec deploy/nabiz -- bun -e "
  import { Database } from 'bun:sqlite'
  new Database('/data/nabiz.db').run(\"VACUUM INTO '/tmp/nabiz-backup.db'\")
"
pod=$(kubectl -n nabiz get pod -l app.kubernetes.io/name=nabiz -o jsonpath='{.items[0].metadata.name}')
kubectl -n nabiz cp "$pod":/tmp/nabiz-backup.db ./nabiz-backup.db
```

## Notes

- `TRUST_PROXY` is `1` because one proxy sits in front — the ingress. The
  notice endpoint throttles by client address, and the address it can
  trust is the last hop the ingress wrote; everything left of that is
  whatever the client sent. Without the variable every request looks like
  the same address, the proxy's.
- That trust has a precondition, which is what `networkpolicy.yaml` is
  for: nothing in a request says whether it came through the ingress, so
  a pod that can reach the Service directly could send any forwarded
  address it liked and guess the token without ever meeting the ten-a-
  minute brake. The policy allows only the ingress namespace. If your
  cluster has no NetworkPolicy controller, or the ingress runs somewhere
  other than `ingress-nginx`, fix the selector or unset `TRUST_PROXY` —
  the throttle counting everyone as one address is the safe failure.
- The root filesystem is read-only. `/data` is the PVC — the write-ahead
  log lives beside the database, in there — and `/tmp` is an emptyDir, for
  the scratch files SQLite writes elsewhere, a `VACUUM INTO` backup among
  them.
- If the pod starts failing its probes the moment the NetworkPolicy is
  applied, that is the policy cutting off the kubelet rather than nabiz:
  the probes come from the node, not from a namespace. Add the node CIDR,
  or drop the policy and unset `TRUST_PROXY`.
- The container runs as uid 1000 — the image's `bun` user — with all
  capabilities dropped and no privilege escalation. `fsGroup` is what makes
  the volume writable by it; a storage class that ignores `fsGroup` needs
  the volume's ownership set some other way.
- Liveness and readiness both use `/health`, which returns 204 and touches
  no database.
- The probe loop runs inside the same process on `NABIZ_INTERVAL_MS`
  (default 60s). There is no CronJob to add.
