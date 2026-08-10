import type { Monitor, ProbeResult } from "./probe"

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

export async function monitors(db: D1Database): Promise<Monitor[]> {
  const { results } = await db
    .prepare("SELECT * FROM monitors WHERE enabled = 1 ORDER BY position, id")
    .all<Monitor>()
  return results
}

function utcDay(at: number): string {
  return new Date(at).toISOString().slice(0, 10)
}

/** Writes one round of results and returns whichever monitors changed state. */
export async function record(db: D1Database, results: ProbeResult[]): Promise<StateChange[]> {
  const now = Date.now()
  const day = utcDay(now)

  const writes: D1PreparedStatement[] = []
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
  const stateWrites: D1PreparedStatement[] = []
  const put = (id: number, ok: boolean, since: number, fails: number) =>
    stateWrites.push(
      db
        .prepare(
          `INSERT INTO state (monitor_id, ok, since, fails) VALUES (?, ?, ?, ?)
           ON CONFLICT (monitor_id)
           DO UPDATE SET ok = excluded.ok, since = excluded.since, fails = excluded.fails`,
        )
        .bind(id, ok ? 1 : 0, since, fails),
    )
  const event = (id: number, ok: boolean) =>
    stateWrites.push(
      db
        .prepare("INSERT INTO events (monitor_id, at, ok) VALUES (?, ?, ?)")
        .bind(id, now, ok ? 1 : 0),
    )

  for (const r of results) {
    const was = known.get(r.monitor.id)

    // The very first sighting is a state, not an event — "it exists and it
    // is up" is not news anybody needs at three in the morning.
    if (was === undefined) {
      put(r.monitor.id, r.ok, now, r.ok ? 0 : 1)
      continue
    }

    if (r.ok) {
      if (!was.ok) {
        changes.push({
          monitor: r.monitor,
          ok: true,
          heldFor: Math.round((now - was.since) / 1000),
        })
        event(r.monitor.id, true)
        put(r.monitor.id, true, now, 0)
      } else if (was.fails > 0) {
        put(r.monitor.id, true, was.since, 0)
      }
      continue
    }

    // One blip in a minute-long window is weather; the monitor is not
    // called down until fail_threshold probes in a row have said so.
    const fails = was.fails + 1
    if (was.ok && fails >= r.monitor.fail_threshold) {
      changes.push({ monitor: r.monitor, ok: false, heldFor: Math.round((now - was.since) / 1000) })
      event(r.monitor.id, false)
      put(r.monitor.id, false, now, fails)
    } else {
      put(r.monitor.id, Boolean(was.ok), was.since, fails)
    }
  }

  if (stateWrites.length > 0) await db.batch(stateWrites)
  return changes
}

/** Raw checks feed only the current-latency figure; two days is plenty.
 *  Events tell a longer story and get half a year. */
export async function prune(db: D1Database): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM checks WHERE at < ?").bind(Date.now() - 2 * 24 * 3600 * 1000),
    db.prepare("DELETE FROM events WHERE at < ?").bind(Date.now() - 180 * 24 * 3600 * 1000),
  ])
}

export interface EventRow {
  monitor_id: number
  at: number
  ok: number
}

export async function recentEvents(db: D1Database, limit: number): Promise<EventRow[]> {
  const { results } = await db
    .prepare("SELECT monitor_id, at, ok FROM events ORDER BY at DESC LIMIT ?")
    .bind(limit)
    .all<EventRow>()
  return results
}

export interface PageData {
  monitors: Monitor[]
  states: Map<number, { ok: boolean; since: number }>
  days: Map<number, DayRow[]>
  latency: Map<number, number>
  /** Last day of successful-probe latency, averaged into hours — 24
   *  points draw a legible shape where 96 drew noise. */
  spark: Map<number, number[]>
}

export async function forPage(db: D1Database, window: number): Promise<PageData> {
  const all = await monitors(db)
  const since = new Date(Date.now() - window * 24 * 3600 * 1000).toISOString().slice(0, 10)

  const [statesQ, daysQ, latencyQ, sparkQ] = await db.batch<never>([
    db.prepare("SELECT monitor_id, ok, since FROM state"),
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
  ])
  if (
    statesQ === undefined ||
    daysQ === undefined ||
    latencyQ === undefined ||
    sparkQ === undefined
  )
    throw new Error("the batch came back short, which D1 does not do")

  const states = new Map<number, { ok: boolean; since: number }>()
  for (const s of statesQ.results as unknown as { monitor_id: number; ok: number; since: number }[])
    states.set(s.monitor_id, { ok: Boolean(s.ok), since: s.since })

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

  return { monitors: all, states, days, latency, spark }
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
  db: D1Database,
  resolvedLimit: number,
  lang: string | null = null,
): Promise<Notice[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM notices
       WHERE (?1 IS NULL OR lang IS NULL OR lang = ?1)
         AND (resolved_at IS NULL
          OR id IN (SELECT id FROM notices WHERE resolved_at IS NOT NULL ORDER BY at DESC LIMIT ?2))
       ORDER BY (resolved_at IS NULL) DESC, at DESC`,
    )
    .bind(lang, resolvedLimit)
    .all<Notice>()
  return results
}

export async function addNotice(
  db: D1Database,
  severity: string,
  body: string,
  lang: string | null,
): Promise<number> {
  const row = await db
    .prepare("INSERT INTO notices (at, severity, body_md, lang) VALUES (?, ?, ?, ?) RETURNING id")
    .bind(Date.now(), severity, body, lang)
    .first<{ id: number }>()
  if (row === null) throw new Error("the insert returned nothing, which D1 does not do")
  return row.id
}

/** True when something was actually resolved just now. */
export async function resolveNotice(db: D1Database, id: number): Promise<boolean> {
  const r = await db
    .prepare("UPDATE notices SET resolved_at = ? WHERE id = ? AND resolved_at IS NULL")
    .bind(Date.now(), id)
    .run()
  return ((r as { meta?: { changes?: number } }).meta?.changes ?? 0) > 0
}
