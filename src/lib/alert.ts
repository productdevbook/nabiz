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
  // A space between the number and the unit: "1h" is English, and the
  // other four write "1 Std", "1 sa", "1 min". And under a minute is
  // seconds, not a rounded-down zero — at a short interval most outages
  // are under a minute.
  const say = (n: number, unit: "unit_h" | "unit_m" | "unit_s") => `${n} ${t(lang, unit)}`
  const text =
    h > 0
      ? `${say(h, "unit_h")} ${say(m, "unit_m")}`
      : m > 0
        ? say(m, "unit_m")
        : say(seconds, "unit_s")
  return ` (${t(lang, "after")} ${text})`
}

/** Long enough for a channel having a slow minute. The round passes its
 *  own budget when it has a shorter one: a deployment probing every two
 *  seconds cannot spend ten of them waiting for a webhook, and measured,
 *  it was skipping two rounds while it did. */
const CHANNEL_MS = 10_000

/** A name is written by an operator and pasted into a line of text. A
 *  newline in one forges a second line — an invented recovery inside an
 *  outage alert — so it is a name for one line only. */
function oneLine(name: string): string {
  let out = ""
  for (const ch of name) {
    const code = ch.codePointAt(0) as number
    // Every character that ends a line, not only the ones below space:
    // NEL, LINE SEPARATOR and PARAGRAPH SEPARATOR break a line too, and
    // the point here is that a name cannot become two lines.
    const breaks =
      code < 0x20 || code === 0x7f || code === 0x85 || code === 0x2028 || code === 0x2029
    out += breaks ? " " : ch
  }
  return out
}

/** Best-effort, and loud about it: a paging channel being down must not
 *  take the probing down with it, but a page that failed to page anybody
 *  must not do it in silence either. Returns how many channels refused. */
async function to(what: string, sending: () => Promise<Response>): Promise<boolean> {
  try {
    const response = await sending()
    if (response.ok) return true
    // A redirect is not a delivery. Followed, a 301 becomes a GET with no
    // body at the destination and answers 200 — so an http:// webhook
    // behind a host that redirects to https loses every alert and reports
    // success. The probe refuses to follow one for the same reason.
    const why =
      response.status >= 300 && response.status < 400
        ? "redirected the alert to"
        : "refused the alert with"
    console.error(`[nabiz] ${what} ${why} ${response.status}`)
  } catch (error) {
    console.error(`[nabiz] ${what} did not take the alert:`, error)
  }
  return false
}

export async function alert(
  env: AlertEnv,
  changes: StateChange[],
  lang: Lang,
  within = CHANNEL_MS,
): Promise<number> {
  if (changes.length === 0) return 0

  const lines = changes.map((c) =>
    c.ok
      ? `✅ ${oneLine(c.monitor.name)} — ${t(lang, "recovered")}${held(c.heldFor, lang)}`
      : `🔴 ${oneLine(c.monitor.name)} — ${t(lang, "down")}`,
  )
  const text = lines.join("\n")
  const at = new Date().toISOString()

  const sends: Promise<boolean>[] = []
  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
    sends.push(
      to("telegram", () =>
        fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: "POST",
          redirect: "manual",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text }),
          signal: AbortSignal.timeout(within),
        }),
      ),
    )
  }
  if (env.ALERT_WEBHOOK_URL) {
    sends.push(
      to("the webhook", () =>
        fetch(env.ALERT_WEBHOOK_URL as string, {
          method: "POST",
          // Not followed: a redirect turns this into a GET with no body,
          // answers 200, and the alert is gone with nothing said.
          redirect: "manual",
          headers: {
            "content-type": "application/json",
            "user-agent": "nabiz (+https://github.com/productdevbook/nabiz)",
          },
          body: JSON.stringify({
            at,
            text,
            changes: changes.map((c) => ({
              slug: c.monitor.slug,
              name: c.monitor.name,
              // Which group it belongs to, so a consumer can decide what
              // to repeat: the page never names a grouped member and this
              // channel does, because an alert nobody can act on is not an
              // alert.
              group: c.monitor.grouped ? (c.monitor.group_name ?? "") : null,
              ok: c.ok,
              held_for: c.heldFor,
            })),
          }),
          signal: AbortSignal.timeout(within),
        }),
      ),
    )
  }
  const answers = await Promise.all(sends)
  return answers.filter((ok) => !ok).length
}
