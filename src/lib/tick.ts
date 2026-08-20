import type { AlertEnv } from "./alert.ts"
import { alert } from "./alert.ts"
import type { Db } from "./db.ts"
import { langOf } from "./i18n.ts"
import { probe } from "./probe.ts"
import { monitors, prune, record } from "./store.ts"

export interface TickEnv extends AlertEnv {
  LANG?: string
}

/** One round of probing, wherever the clock comes from: the Workers cron
 *  or an interval in a process somebody owns. Returns what changed. */
/** A round has to end before the next one is due. Six probes wait for
 *  headers at a time on Workers, so a general outage with generous
 *  timeouts would otherwise queue past the minute and have the next cron
 *  land on top of it — two rounds writing the same minute, two recovery
 *  alerts for one recovery. A probe that has not answered by then has
 *  failed, which is what a status page would say about it anyway. */
const ROUND_MS = 45_000

export async function tick(db: Db, env: TickEnv, sweep: boolean): Promise<number> {
  const watched = await monitors(db)
  if (watched.length === 0) return 0

  const deadline = AbortSignal.timeout(ROUND_MS)
  const results = await Promise.all(watched.map((m) => probe(m, deadline)))
  const changes = await record(db, results)
  await alert(env, changes, langOf(env.LANG))
  if (sweep) await prune(db)
  return changes.length
}
