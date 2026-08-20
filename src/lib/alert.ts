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

/** Long enough for a channel having a slow minute, short enough that it
 *  cannot hold the round past the next one. */
const CHANNEL_MS = 10_000

/** Best-effort, and loud about it: a paging channel being down must not
 *  take the probing down with it, but a page that failed to page anybody
 *  must not do it in silence either. Returns how many channels refused. */
async function to(what: string, sending: Promise<Response>): Promise<boolean> {
  try {
    const response = await sending
    if (response.ok) return true
    console.error(`[nabiz] ${what} refused the alert with ${response.status}`)
  } catch (error) {
    console.error(`[nabiz] ${what} did not take the alert:`, error)
  }
  return false
}

export async function alert(env: AlertEnv, changes: StateChange[], lang: Lang): Promise<number> {
  if (changes.length === 0) return 0

  const lines = changes.map((c) =>
    c.ok
      ? `✅ ${c.monitor.name} — ${t(lang, "recovered")}${held(c.heldFor, lang)}`
      : `🔴 ${c.monitor.name} — ${t(lang, "down")}`,
  )
  const text = lines.join("\n")

  const sends: Promise<boolean>[] = []
  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
    sends.push(
      to(
        "telegram",
        fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text }),
          signal: AbortSignal.timeout(CHANNEL_MS),
        }),
      ),
    )
  }
  if (env.ALERT_WEBHOOK_URL) {
    sends.push(
      to(
        "the webhook",
        fetch(env.ALERT_WEBHOOK_URL, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            text,
            changes: changes.map((c) => ({ slug: c.monitor.slug, name: c.monitor.name, ok: c.ok })),
          }),
          signal: AbortSignal.timeout(CHANNEL_MS),
        }),
      ),
    )
  }
  const answers = await Promise.all(sends)
  return answers.filter((ok) => !ok).length
}
