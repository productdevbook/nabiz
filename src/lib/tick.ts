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
export async function tick(db: Db, env: TickEnv, sweep: boolean): Promise<number> {
  const watched = await monitors(db)
  if (watched.length === 0) return 0

  const results = await Promise.all(watched.map(probe))
  const changes = await record(db, results)
  await alert(env, changes, langOf(env.LANG))
  if (sweep) await prune(db)
  return changes.length
}
