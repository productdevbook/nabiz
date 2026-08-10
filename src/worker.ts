// The whole worker: Astro answers the requests, the cron keeps probing —
// one deployment, two duties.
import { handle } from "@astrojs/cloudflare/handler"

import { alert } from "./lib/alert"
import { langOf } from "./lib/i18n"
import { probe } from "./lib/probe"
import { monitors, prune, record } from "./lib/store"

export default {
  fetch: handle,
  async scheduled(controller: ScheduledController, env: Env) {
    const watched = await monitors(env.DB)
    if (watched.length === 0) return

    const results = await Promise.all(watched.map(probe))
    const changes = await record(env.DB, results)
    await alert(env, changes, langOf(env.LANG))

    // Once an hour is often enough to sweep what has aged out.
    if (new Date(controller.scheduledTime).getUTCMinutes() === 0) await prune(env.DB)
  },
} satisfies ExportedHandler<Env>
