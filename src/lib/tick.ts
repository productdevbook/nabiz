import type { AlertEnv } from "./alert.ts"
import { alert } from "./alert.ts"
import type { Db } from "./db.ts"
import { langOf } from "./i18n.ts"
import { probe } from "./probe.ts"
import { monitors, prune, record } from "./store.ts"

export interface TickEnv extends AlertEnv {
  LANG?: string
}

/** Three quarters of a minute, for the deployment that probes once a
 *  minute. A round has to end before the next one is due: six probes wait
 *  for headers at a time on Workers, so a general outage with generous
 *  timeouts would queue past the interval and have the next round land on
 *  top of it — two rounds writing the same minute, two recovery alerts for
 *  one recovery. A probe that has not answered by then has failed, which
 *  is what a status page would say about it anyway. */
const ROUND_MS = 45_000

/** One round of probing, from whatever holds the clock. `within` is how
 *  long the round may take; a deployment that probes more often than once
 *  a minute passes its own. Returns what changed. */
export async function tick(
  db: Db,
  env: TickEnv,
  sweep: boolean,
  within = ROUND_MS,
): Promise<number> {
  const watched = await monitors(db)
  if (watched.length === 0) return 0

  const deadline = AbortSignal.timeout(within)
  const results = await Promise.all(watched.map((m) => probe(m, deadline)))
  const changes = await record(db, results)
  // A quarter of the round's budget: a channel that hangs must not cost
  // the rounds that come after it.
  const refused = await alert(
    env,
    changes,
    langOf(env.LANG),
    Math.max(1_000, Math.round(within / 4)),
  )
  if (refused > 0)
    // Which alert was lost, not only that one was: the log is the only
    // place this is ever said.
    console.error(
      `[nabiz] ${refused} channel(s) took no alert; nobody was told about ${changes
        .map((c) => `${c.monitor.slug} ${c.ok ? "recovered" : "down"}`)
        .join(", ")}`,
    )
  if (sweep) await prune(db, watched)
  return changes.length
}
