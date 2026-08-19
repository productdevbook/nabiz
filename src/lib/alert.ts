import type { Lang } from "./i18n.ts"
import { t } from "./i18n.ts"
import type { StateChange } from "./store.ts"

export interface AlertEnv {
  TELEGRAM_BOT_TOKEN?: string
  TELEGRAM_CHAT_ID?: string
  ALERT_WEBHOOK_URL?: string
}

function held(seconds: number | null, lang: Lang): string {
  if (seconds === null) return ""
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const hours = `${h}${t(lang, "unit_h")}`
  const mins = `${m}${t(lang, "unit_m")}`
  return ` (${t(lang, "after")} ${h > 0 ? `${hours} ${mins}` : mins})`
}

/** Says what changed, wherever the operator asked to hear it. Best-effort:
 *  a paging channel being down must not take the probing down with it. */
export async function alert(env: AlertEnv, changes: StateChange[], lang: Lang): Promise<void> {
  if (changes.length === 0) return

  const lines = changes.map((c) =>
    c.ok
      ? `✅ ${c.monitor.name} — ${t(lang, "recovered")}${held(c.heldFor, lang)}`
      : `🔴 ${c.monitor.name} — ${t(lang, "down")}`,
  )
  const text = lines.join("\n")

  const sends: Promise<unknown>[] = []
  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
    sends.push(
      fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text }),
      }).catch(() => {}),
    )
  }
  if (env.ALERT_WEBHOOK_URL) {
    sends.push(
      fetch(env.ALERT_WEBHOOK_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text,
          changes: changes.map((c) => ({ slug: c.monitor.slug, name: c.monitor.name, ok: c.ok })),
        }),
      }).catch(() => {}),
    )
  }
  await Promise.allSettled(sends)
}
