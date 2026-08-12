import type { Monitor } from "./probe"
import type { DayRow, EventRow, PageData } from "./store"

/** One line on the page or in the API: a monitor, or a group speaking for
 *  its members. Grouped members never appear on their own, and neither
 *  does their number — a public status page does not have to be a public
 *  customer list, and "4/5 up" is a customer count in disguise. */
export interface Row {
  name: string
  ok: boolean | null
  /** A group with some members up and some down. One customer's site being
   *  unreachable is not every customer's site being unreachable, and a row
   *  that says otherwise makes the page lie about the machine. */
  partial: boolean
  days: DayRow[]
  latency: number | null
  spark: number[] | null
}

/** How much of a group has to be unreachable before the group is called
 *  down rather than troubled. Half: one site of five is a site's problem,
 *  three of five is the machine's, and the page should say which. */
export const GROUP_OUTAGE = 0.5

/** A group's day, as the group experienced it: the median member's.
 *
 *  Adding the members up would let one site's bad afternoon drag the whole
 *  group's history down — five sites, one down for two hours, and the row
 *  reports a fifth of that outage as if everyone had suffered it. The
 *  median moves only when half the group does, which is the same line the
 *  group's state is drawn at.
 *
 *  What it costs: a site that is down alone leaves no mark on the group's
 *  ninety days. That history is the group's, not any member's, and the
 *  member's own is not this page's to publish. */
function medianDays(lists: DayRow[][]): DayRow[] {
  const byDay = new Map<string, { ok: number; total: number }[]>()
  for (const list of lists)
    for (const d of list) {
      if (d.total === 0) continue
      const seen = byDay.get(d.day) ?? []
      seen.push({ ok: d.ok, total: d.total })
      byDay.set(d.day, seen)
    }

  const out: DayRow[] = []
  for (const [day, members] of byDay) {
    const shares = members.map((m) => m.ok / m.total).toSorted((a, b) => a - b)
    const middle =
      shares.length % 2 === 1
        ? (shares[(shares.length - 1) / 2] as number)
        : ((shares[shares.length / 2 - 1] as number) + (shares[shares.length / 2] as number)) / 2
    // Kept on one scale — a thousand imagined checks — so the bars and the
    // percentage read exactly as they do for a single monitor.
    const total = 1000
    out.push({ monitor_id: 0, day, total, ok: Math.round(middle * total), ms_sum: 0 })
  }
  return out.toSorted((a, b) => (a.day < b.day ? -1 : 1))
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
      spark: data.spark.get(m.id) ?? null,
    })
  }

  for (const [name, members] of grouped) {
    const up = members.filter((m) => data.states.get(m.id)?.ok).length
    const known = members.filter((m) => data.states.get(m.id) !== undefined).length
    const downs = known - up
    out.push({
      name,
      // Down only once enough of the group is unreachable to be the
      // machine's problem rather than one site's.
      ok: known === 0 ? null : downs === 0,
      partial: known > 0 && downs > 0 && downs / known < GROUP_OUTAGE,
      days: medianDays(members.map((m) => data.days.get(m.id) ?? [])),
      latency: null,
      spark: null,
    })
  }
  return out
}

/** What the whole page is, in one word.
 *
 *  `sites` is its own state rather than a shade of `degraded`, because the
 *  two are different news for different people. A service being down is
 *  everyone's problem; a few of the hosted sites being unreachable is
 *  their owners' problem, and the banner should say which it is instead
 *  of alarming everybody or — worse — going quiet. */
export type Overall = "up" | "sites" | "degraded" | "down"

export function overall(list: Row[]): Overall {
  const known = list.filter((r) => r.ok !== null)
  if (known.length === 0) return "up"
  const troubled = known.filter((r) => r.ok === false && !r.partial)
  if (troubled.length > 0) {
    return troubled.length === known.length ? "down" : "degraded"
  }
  // Nothing is fully down, but some hosted sites are unreachable. Said
  // plainly rather than hidden: a page that stays green while somebody's
  // site is dark is lying to them, and one that cries outage over it
  // teaches everybody else to stop reading it.
  return known.some((r) => r.partial) ? "sites" : "up"
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
