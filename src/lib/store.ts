import type { Db, Stmt } from "./db.ts"
import type { Monitor, ProbeResult, Reason } from "./probe.ts"

export interface DayRow {
  monitor_id: number
  day: string
  total: number
  ok: number
  ms_sum: number
}

export interface StateChange {
  monitor: Monitor
  ok: boolean
  /** Seconds the previous state had held, for the recovery message. */
  heldFor: number | null
}

export async function monitors(db: Db): Promise<Monitor[]> {
  const { results } = await db
    .prepare("SELECT * FROM monitors WHERE enabled = 1 ORDER BY position, id")
    .all<Monitor>()
  return results
}

function utcDay(at: number): string {
  return new Date(at).toISOString().slice(0, 10)
}

/** Writes one round of results and returns whichever monitors changed state. */
export async function record(db: Db, results: ProbeResult[]): Promise<StateChange[]> {
  const now = Date.now()
  const day = utcDay(now)

  const writes: Stmt[] = []
  for (const r of results) {
    writes.push(
      db
        .prepare("INSERT INTO checks (monitor_id, at, ok, status, ms) VALUES (?, ?, ?, ?, ?)")
        .bind(r.monitor.id, now, r.ok ? 1 : 0, r.status, r.ms),
      db
        .prepare(
          `INSERT INTO days (monitor_id, day, total, ok, ms_sum) VALUES (?, ?, 1, ?, ?)
           ON CONFLICT (monitor_id, day)
           DO UPDATE SET total = total + 1, ok = ok + excluded.ok, ms_sum = ms_sum + excluded.ms_sum`,
        )
        .bind(r.monitor.id, day, r.ok ? 1 : 0, r.ms),
    )
  }
  await db.batch(writes)

  const { results: states } = await db
    .prepare("SELECT monitor_id, ok, since, fails FROM state")
    .all<{ monitor_id: number; ok: number; since: number; fails: number }>()
  const known = new Map(states.map((s) => [s.monitor_id, s]))

  const changes: StateChange[] = []
  const stateWrites: Stmt[] = []
  const put = (id: number, ok: boolean, since: number, fails: number, r: ProbeResult) =>
    stateWrites.push(
      db
        .prepare(
          `INSERT INTO state (monitor_id, ok, since, fails, last_status, last_reason)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (monitor_id)
           DO UPDATE SET ok = excluded.ok, since = excluded.since, fails = excluded.fails,
                         last_status = excluded.last_status, last_reason = excluded.last_reason`,
        )
        .bind(id, ok ? 1 : 0, since, fails, r.status, r.reason),
    )
  // The kind is written on the row, not looked up when it is read: a
  // window that has to join to find out cannot stop at its limit, and
  // scans every event ever kept when its side is empty.
  const event = (m: Monitor, ok: boolean) =>
    stateWrites.push(
      db
        .prepare("INSERT INTO events (monitor_id, at, ok, grouped) VALUES (?, ?, ?, ?)")
        .bind(m.id, now, ok ? 1 : 0, m.grouped ? 1 : 0),
    )

  for (const r of results) {
    const was = known.get(r.monitor.id)

    // "It exists and it is up" is not news anybody needs at three in the
    // morning, so a first sighting that is up is a state and nothing more.
    // A first sighting that is down is news: it is the URL somebody just
    // added not answering, and saying nothing leaves them watching a red
    // row wondering whether the page works.
    if (was === undefined) {
      put(r.monitor.id, r.ok, now, r.ok ? 0 : 1, r)
      if (!r.ok) {
        changes.push({ monitor: r.monitor, ok: false, heldFor: null })
        event(r.monitor, false)
      }
      continue
    }

    if (r.ok) {
      if (!was.ok) {
        changes.push({
          monitor: r.monitor,
          ok: true,
          heldFor: Math.round((now - was.since) / 1000),
        })
        event(r.monitor, true)
        put(r.monitor.id, true, now, 0, r)
      } else {
        put(r.monitor.id, true, was.since, 0, r)
      }
      continue
    }

    // One blip in a minute-long window is weather; the monitor is not
    // called down until fail_threshold probes in a row have said so.
    const fails = was.fails + 1
    if (was.ok && fails >= r.monitor.fail_threshold) {
      changes.push({ monitor: r.monitor, ok: false, heldFor: Math.round((now - was.since) / 1000) })
      event(r.monitor, false)
      put(r.monitor.id, false, now, fails, r)
    } else {
      put(r.monitor.id, Boolean(was.ok), was.since, fails, r)
    }
  }

  try {
    if (stateWrites.length > 0) await db.batch(stateWrites)
  } finally {
    // After the writes, never before: a render that landed between the
    // checks and the state would otherwise have cached half a round and
    // kept it for the whole window.
    forget(db)
  }
  return changes
}

/** Raw checks feed only the current-latency figure; two days is plenty.
 *  Events tell a longer story and get half a year, and the daily rollup a
 *  year — the page draws ninety of them.
 *
 *  It also clears what no monitor owns any more. That is housekeeping, not
 *  a guarantee: `monitors.id` is a rowid, so a monitor inserted after one
 *  is deleted can be handed the same id and everything left behind with
 *  it. Disabling is what keeps a history safely; deleting is what needs
 *  this sweep to have run in between. */
export async function prune(db: Db, watched: Monitor[] = []): Promise<void> {
  const now = Date.now()
  const before = (days: number) => now - days * 24 * 3600 * 1000
  const orphans = (table: string) =>
    db.prepare(`DELETE FROM ${table} WHERE monitor_id NOT IN (SELECT id FROM monitors)`)
  // The kind on an event row is a copy of the monitor's, and a copy goes
  // stale: an operator moves a service into a group by editing the row
  // this code never writes. Left alone, that service's whole history sits
  // in the wrong window and crowds out the one it left. Both directions,
  // by the same rule the page labels rows with.
  // In batches, because the list goes into the statement rather than into
  // a parameter: one of fifteen thousand ids is a statement D1 answers
  // SQLITE_NOMEM to, and `batch` is a transaction — the sweep's deletes
  // would be discarded with it and the database would grow forever.
  const CHUNK = 500
  const reconcile = (grouped: boolean): Stmt[] => {
    const ids = watched.filter((m) => Boolean(m.grouped) === grouped).map((m) => m.id)
    const out: Stmt[] = []
    for (let i = 0; i < ids.length; i += CHUNK)
      out.push(
        db.prepare(
          `UPDATE events SET grouped = ${grouped ? 1 : 0}
           WHERE grouped = ${grouped ? 0 : 1} AND monitor_id IN (${ids.slice(i, i + CHUNK).join(",")})`,
        ),
      )
    return out
  }
  await db.batch([
    db.prepare("DELETE FROM checks WHERE at < ?").bind(before(2)),
    db.prepare("DELETE FROM events WHERE at < ?").bind(before(180)),
    db
      .prepare("DELETE FROM days WHERE day < ?")
      .bind(new Date(before(365)).toISOString().slice(0, 10)),
    orphans("checks"),
    orphans("days"),
    orphans("events"),
    orphans("state"),
    ...reconcile(true),
    ...reconcile(false),
  ])
  forget(db)
}

export interface EventRow {
  monitor_id: number
  at: number
  ok: number
}

/** How many event rows a page reads before the view collapses them, per
 *  kind: named services get this many and grouped ones get this many, so
 *  a read returns up to twice it. A group's members write one event each
 *  and a group in permanent trouble writes many that collapse to none, so
 *  the read has to be much wider than the list — and the same width
 *  everywhere, or the page, the JSON and the feed disagree about what
 *  happened. */
export const EVENT_ROWS = 400

export async function recentEvents(db: Db, limit: number): Promise<EventRow[]> {
  // Joined rather than filtered afterwards: a disabled monitor's events are
  // not shown, and taking the limit first let a flapping one nobody watches
  // any more push every visible event off the page.
  //
  // Two windows rather than one, because a group's members write an event
  // each: four hundred of them fill a single window in one round and every
  // named service's history disappears from the page.
  const window = `SELECT e.monitor_id, e.at, e.ok FROM events e
       JOIN monitors m ON m.id = e.monitor_id AND m.enabled = 1
       WHERE e.grouped = ? ORDER BY e.at DESC LIMIT ?`
  const { results } = await db
    .prepare(
      `SELECT monitor_id, at, ok FROM (${window}) UNION ALL
       SELECT monitor_id, at, ok FROM (${window}) ORDER BY at DESC`,
    )
    .bind(0, limit, 1, limit)
    .all<EventRow>()
  return results
}

export interface PageData {
  monitors: Monitor[]
  states: Map<number, { ok: boolean; code: number | null; reason: Reason }>
  days: Map<number, DayRow[]>
  latency: Map<number, number>
  /** Last day of successful-probe latency, averaged into hours — 24
   *  points draw a legible shape where 96 drew noise. */
  spark: Map<number, number[]>
  /** When a probe last wrote anything. The page says it was updated then,
   *  which is a different claim from "this page rendered just now" — and
   *  the difference is exactly what a full disk or a stopped loop looks
   *  like from outside. */
  wrote: number | null
}

/** The same window the edge holds the page for, and for the same reason:
 *  a status page's traffic spikes exactly when things are down, and
 *  nothing served from here is staler than the data behind it — the probes
 *  run a minute apart. Kept per database so two of them in one process
 *  cannot read each other's answer, and dropped the moment anything is
 *  written. */
const PAGE_MS = 15_000

interface Held {
  at: number
  window: number
  data: PageData
}

// This module is instantiated twice in a server: once inside the Astro
// bundle that renders the page, once from source in the process that
// probes. The database handle is already pinned across both
// (src/server/env.ts); what the page remembers has to be pinned the same
// way, or the round forgets on a map the render never reads.
const across = globalThis as {
  nabizPage?: WeakMap<Db, Held>
  nabizWrote?: { n: number }
  nabizHold?: { ms: number }
}
const recent = (across.nabizPage ??= new WeakMap<Db, Held>())
// Counted, not just cleared: a read that began before a write and finished
// after it would otherwise store what it saw halfway through.
const writes = (across.nabizWrote ??= { n: 0 })

/** How long a deployment holds it, when it knows better than the default.
 *  A server invalidates on every round, so it can hold until then; on
 *  Cloudflare the cron may run in an isolate that never touches this copy,
 *  and fifteen seconds is the only bound there is. */
const hold = (across.nabizHold ??= { ms: PAGE_MS })

export function holdFor(ms: number): void {
  hold.ms = Math.max(1_000, ms)
}

/** Called by every write: what the page says next has to include it. */
export function forget(db: Db): void {
  writes.n += 1
  recent.delete(db)
}

export async function forPage(db: Db, window: number): Promise<PageData> {
  const held = recent.get(db)
  if (held !== undefined && held.window === window && Date.now() - held.at < hold.ms)
    return held.data
  const began = writes.n
  const data = await read(db, window)
  // Anything written while this was reading makes it a snapshot of a
  // moment that never was; serve it, do not remember it.
  if (writes.n === began) recent.set(db, { at: Date.now(), window, data })
  return data
}

async function read(db: Db, window: number): Promise<PageData> {
  const all = await monitors(db)
  const since = new Date(Date.now() - window * 24 * 3600 * 1000).toISOString().slice(0, 10)

  const [statesQ, daysQ, latencyQ, sparkQ, wroteQ] = await db.batch<never>([
    db.prepare("SELECT monitor_id, ok, last_status, last_reason FROM state"),
    db.prepare("SELECT * FROM days WHERE day >= ? ORDER BY day").bind(since),
    db
      .prepare(`SELECT monitor_id, ms FROM checks WHERE ok = 1 AND at > ? ORDER BY at`)
      .bind(Date.now() - 3600 * 1000),
    db
      .prepare(
        `SELECT monitor_id, at / 3600000 AS bucket, CAST(AVG(ms) AS INTEGER) AS ms
         FROM checks WHERE ok = 1 AND at > ? GROUP BY monitor_id, bucket ORDER BY bucket`,
      )
      .bind(Date.now() - 24 * 3600 * 1000),
    db.prepare("SELECT MAX(at) AS at FROM checks"),
  ])
  if (
    statesQ === undefined ||
    daysQ === undefined ||
    latencyQ === undefined ||
    sparkQ === undefined ||
    wroteQ === undefined
  )
    throw new Error("the batch came back short, which D1 does not do")

  const states = new Map<number, { ok: boolean; code: number | null; reason: Reason }>()
  for (const s of statesQ.results as unknown as {
    monitor_id: number
    ok: number
    last_status: number | null
    last_reason: Reason
  }[])
    states.set(s.monitor_id, { ok: Boolean(s.ok), code: s.last_status, reason: s.last_reason })

  const days = new Map<number, DayRow[]>()
  for (const d of daysQ.results as unknown as DayRow[]) {
    const list = days.get(d.monitor_id) ?? []
    list.push(d)
    days.set(d.monitor_id, list)
  }

  // Last successful answer's timing wins — written in arrival order above.
  const latency = new Map<number, number>()
  for (const c of latencyQ.results as unknown as { monitor_id: number; ms: number }[])
    latency.set(c.monitor_id, c.ms)

  const spark = new Map<number, number[]>()
  for (const p of sparkQ.results as unknown as { monitor_id: number; ms: number }[]) {
    const list = spark.get(p.monitor_id) ?? []
    list.push(p.ms)
    spark.set(p.monitor_id, list)
  }

  const wrote = (wroteQ.results as unknown as { at: number | null }[])[0]?.at ?? null

  return { monitors: all, states, days, latency, spark, wrote }
}

export interface Notice {
  id: number
  at: number
  severity: string
  body_md: string
  resolved_at: number | null
  /** Which audience this speaks to; null speaks to all of them. */
  lang: string | null
}

/** Open notices first, newest first; the resolved tail is capped so the
 *  page tells the story without becoming the archive. */
export async function notices(
  db: Db,
  resolvedLimit: number,
  lang: string | null = null,
): Promise<Notice[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM notices
       WHERE (?1 IS NULL OR lang IS NULL OR lang = ?1)
         AND (resolved_at IS NULL
          OR id IN (SELECT id FROM notices
                     WHERE resolved_at IS NOT NULL
                       AND (?1 IS NULL OR lang IS NULL OR lang = ?1)
                     ORDER BY at DESC LIMIT ?2))
       ORDER BY (resolved_at IS NULL) DESC, at DESC`,
    )
    .bind(lang, resolvedLimit)
    .all<Notice>()
  return results
}

export async function addNotice(
  db: Db,
  severity: string,
  body: string,
  lang: string | null,
): Promise<number> {
  const row = await db
    .prepare("INSERT INTO notices (at, severity, body_md, lang) VALUES (?, ?, ?, ?) RETURNING id")
    .bind(Date.now(), severity, body, lang)
    .first<{ id: number }>()
  forget(db)
  if (row === null) throw new Error("the insert returned nothing, which D1 does not do")
  return row.id
}

/** True when something was actually resolved just now. */
export async function resolveNotice(db: Db, id: number): Promise<boolean> {
  const r = await db
    .prepare("UPDATE notices SET resolved_at = ? WHERE id = ? AND resolved_at IS NULL")
    .bind(Date.now(), id)
    .run()
  forget(db)
  return (r.meta?.changes ?? 0) > 0
}
