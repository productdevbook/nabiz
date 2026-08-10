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
    .prepare("SELECT monitor_id, ok, since FROM state")
    .all<{ monitor_id: number; ok: number; since: number }>()
  const known = new Map(states.map((s) => [s.monitor_id, s]))

  const changes: StateChange[] = []
  const stateWrites: D1PreparedStatement[] = []
  for (const r of results) {
    const was = known.get(r.monitor.id)
    if (was === undefined || Boolean(was.ok) !== r.ok) {
      // A monitor's very first probe is a state too, but "it exists and it
      // is up" is not news anybody needs at three in the morning.
      if (was !== undefined) {
        changes.push({
          monitor: r.monitor,
          ok: r.ok,
          heldFor: Math.round((now - was.since) / 1000),
        })
      }
      stateWrites.push(
        db
          .prepare(
            `INSERT INTO state (monitor_id, ok, since) VALUES (?, ?, ?)
             ON CONFLICT (monitor_id) DO UPDATE SET ok = excluded.ok, since = excluded.since`,
          )
          .bind(r.monitor.id, r.ok ? 1 : 0, now),
      )
      // The very first sighting is a state, not an event.
      if (was !== undefined)
        stateWrites.push(
          db
            .prepare("INSERT INTO events (monitor_id, at, ok) VALUES (?, ?, ?)")
            .bind(r.monitor.id, now, r.ok ? 1 : 0),
        )
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
}

export async function forPage(db: D1Database, window: number): Promise<PageData> {
  const all = await monitors(db)
  const since = new Date(Date.now() - window * 24 * 3600 * 1000).toISOString().slice(0, 10)

  const [statesQ, daysQ, latencyQ] = await db.batch<never>([
    db.prepare("SELECT monitor_id, ok, since FROM state"),
    db.prepare("SELECT * FROM days WHERE day >= ? ORDER BY day").bind(since),
    db
      .prepare(`SELECT monitor_id, ms FROM checks WHERE ok = 1 AND at > ? ORDER BY at`)
      .bind(Date.now() - 3600 * 1000),
  ])
  if (statesQ === undefined || daysQ === undefined || latencyQ === undefined)
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

  return { monitors: all, states, days, latency }
}
