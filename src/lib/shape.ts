import type { Monitor } from "./probe"
import type { DayRow, EventRow, PageData } from "./store"

/** One line on the page or in the API: a monitor, or a group speaking for
 *  its members. Grouped members never appear on their own — a public status
 *  page does not have to be a public customer list. */
export interface Row {
  name: string
  ok: boolean | null
  /** A group with some members up and some down. One customer's site being
   *  unreachable is not every customer's site being unreachable, and a row
   *  that says otherwise makes the page lie about the machine. */
  partial: boolean
  days: DayRow[]
  latency: number | null
  tally: string | null
  spark: number[] | null
}

function mergeDays(lists: DayRow[][]): DayRow[] {
  const byDay = new Map<string, DayRow>()
  for (const list of lists)
    for (const d of list) {
      const m = byDay.get(d.day) ?? { monitor_id: 0, day: d.day, total: 0, ok: 0, ms_sum: 0 }
      m.total += d.total
      m.ok += d.ok
      m.ms_sum += d.ms_sum
      byDay.set(d.day, m)
    }
  return [...byDay.values()].toSorted((a, b) => (a.day < b.day ? -1 : 1))
}

export function rows(data: PageData): Row[] {
  const out: Row[] = []
  const grouped = new Map<string, Monitor[]>()

  for (const m of data.monitors) {
    if (m.grouped && m.group_name) {
      const list = grouped.get(m.group_name) ?? []
      list.push(m)
      grouped.set(m.group_name, list)
      continue
    }
    const s = data.states.get(m.id)
    out.push({
      name: m.name,
      ok: s ? s.ok : null,
      partial: false,
      days: data.days.get(m.id) ?? [],
      latency: data.latency.get(m.id) ?? null,
      tally: null,
      spark: data.spark.get(m.id) ?? null,
    })
  }

  for (const [name, members] of grouped) {
    const up = members.filter((m) => data.states.get(m.id)?.ok).length
    const known = members.filter((m) => data.states.get(m.id) !== undefined).length
    out.push({
      name,
      ok: known === 0 ? null : up === known,
      partial: known > 0 && up > 0 && up < known,
      days: mergeDays(members.map((m) => data.days.get(m.id) ?? [])),
      latency: null,
      tally: known === 0 ? null : `${up}/${known}`,
      spark: null,
    })
  }
  return out
}

export type Overall = "up" | "degraded" | "down"

export function overall(list: Row[]): Overall {
  const known = list.filter((r) => r.ok !== null)
  const troubled = known.filter((r) => r.ok === false)
  if (known.length === 0 || troubled.length === 0) return "up"
  // A group that is partly up is trouble, never a total outage: everything
  // being down is the one claim this page must not make lightly.
  const total = troubled.every((r) => !r.partial) && troubled.length === known.length
  return total ? "down" : "degraded"
}

export function uptimeOf(days: DayRow[]): number | null {
  let total = 0
  let ok = 0
  for (const d of days) {
    total += d.total
    ok += d.ok
  }
  return total === 0 ? null : (100 * ok) / total
}

export interface EventView {
  label: string
  at: number
  ok: boolean
}

/** Events with grouped members speaking under their group's name. */
export function eventsView(monitors: Monitor[], events: EventRow[]): EventView[] {
  const byId = new Map(monitors.map((m) => [m.id, m]))
  const out: EventView[] = []
  for (const e of events) {
    const m = byId.get(e.monitor_id)
    if (m === undefined) continue
    out.push({
      label: m.grouped && m.group_name ? m.group_name : m.name,
      at: e.at,
      ok: Boolean(e.ok),
    })
  }
  return out
}
