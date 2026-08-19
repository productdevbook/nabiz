import type { Monitor } from "./probe.ts"
import type { DayRow, EventRow, PageData } from "./store.ts"

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

/** What a group with no name of its own is called. A row that says it is
 *  grouped is never published by name, so a missing group name cannot be
 *  allowed to fall back to the monitor's — that is the one leak the column
 *  exists to prevent. */
export const UNNAMED_GROUP = "—"

/** The group a monitor speaks under, or null if it speaks for itself. */
export function groupOf(m: Monitor): string | null {
  if (!m.grouped) return null
  const named = (m.group_name ?? "").trim()
  return named === "" ? UNNAMED_GROUP : named
}

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
  const size = lists.length
  const byDay = new Map<string, DayRow[]>()
  for (const list of lists)
    for (const d of list) {
      if (d.total === 0) continue
      const seen = byDay.get(d.day) ?? []
      seen.push(d)
      byDay.set(d.day, seen)
    }

  const out: DayRow[] = []
  for (const [, members] of byDay) {
    // A day most of the group did not exist for has no median to report.
    // Without this, the first customer's bad afternoon is published as the
    // whole group's the moment the others are onboarded later.
    if (members.length * 2 < size) continue
    const ranked = members.toSorted((a, b) => a.ok / a.total - b.ok / b.total)
    // The median member's own day, counts and timings and all: a made-up
    // denominator would be a number no probe produced, and history.json
    // would publish it as if one had.
    const middle = ranked[(ranked.length - 1) >> 1] as DayRow
    out.push({ ...middle, monitor_id: 0 })
  }
  return out.toSorted((a, b) => (a.day < b.day ? -1 : 1))
}

export function rows(data: PageData): Row[] {
  // Monitors arrive ordered by position; a group takes the place of its
  // earliest member, which is the only way an operator can put one
  // anywhere but last.
  const out: { at: number; row: Row }[] = []
  const grouped = new Map<string, { at: number; members: Monitor[] }>()

  data.monitors.forEach((m, at) => {
    const group = groupOf(m)
    if (group !== null) {
      const held = grouped.get(group) ?? { at, members: [] }
      held.members.push(m)
      grouped.set(group, held)
      return
    }
    const s = data.states.get(m.id)
    out.push({
      at,
      row: {
        name: m.name,
        ok: s ? s.ok : null,
        partial: false,
        days: data.days.get(m.id) ?? [],
        latency: data.latency.get(m.id) ?? null,
        spark: data.spark.get(m.id) ?? null,
      },
    })
  })

  for (const [name, { at, members }] of grouped) {
    const up = members.filter((m) => data.states.get(m.id)?.ok).length
    const known = members.filter((m) => data.states.get(m.id) !== undefined).length
    const downs = known - up
    out.push({
      at,
      row: {
        name,
        // Down only once enough of the group is unreachable to be the
        // machine's problem rather than one site's.
        ok: known === 0 ? null : downs === 0,
        partial: known > 0 && downs > 0 && downs / known < GROUP_OUTAGE,
        days: medianDays(members.map((m) => data.days.get(m.id) ?? [])),
        latency: null,
        spark: null,
      },
    })
  }
  return out.toSorted((a, b) => a.at - b.at).map((e) => e.row)
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
  // A round writes every member's event at the same millisecond, so a
  // shared host going down would print the group's line once per member —
  // and counting those lines is counting the customers.
  const said = new Set<string>()
  for (const e of events) {
    const m = byId.get(e.monitor_id)
    if (m === undefined) continue
    const group = groupOf(m)
    if (group !== null) {
      const once = `${group}\u0000${e.at}\u0000${e.ok}`
      if (said.has(once)) continue
      said.add(once)
    }
    out.push({
      label: group ?? m.name,
      at: e.at,
      ok: Boolean(e.ok),
    })
  }
  return out
}
