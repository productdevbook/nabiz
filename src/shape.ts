import type { Monitor } from "./probe"
import type { DayRow, EventRow, PageData } from "./store"

/** One line on the page or in the API: a monitor, or a group speaking for
 *  its members. Grouped members never appear on their own — a public status
 *  page does not have to be a public customer list. */
export interface Row {
  name: string
  ok: boolean | null
  days: DayRow[]
  latency: number | null
  tally: string | null
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
      days: data.days.get(m.id) ?? [],
      latency: data.latency.get(m.id) ?? null,
      tally: null,
    })
  }

  for (const [name, members] of grouped) {
    const up = members.filter((m) => data.states.get(m.id)?.ok).length
    const known = members.filter((m) => data.states.get(m.id) !== undefined).length
    out.push({
      name,
      ok: known === 0 ? null : up === known,
      days: mergeDays(members.map((m) => data.days.get(m.id) ?? [])),
      latency: null,
      tally: known === 0 ? null : `${up}/${known}`,
    })
  }
  return out
}

export type Overall = "up" | "degraded" | "down"

export function overall(list: Row[]): Overall {
  const known = list.filter((r) => r.ok !== null)
  const downs = known.filter((r) => r.ok === false).length
  if (known.length === 0 || downs === 0) return "up"
  return downs === known.length ? "down" : "degraded"
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
