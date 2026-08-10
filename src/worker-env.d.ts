// The worker's environment, declared globally the way `wrangler types`
// would — the Cloudflare adapter's own types expect to find it here.
interface Env {
  DB: D1Database
  ASSETS: Fetcher
  LANG?: string
  TITLE?: string
  ADMIN_TOKEN?: string
  TELEGRAM_BOT_TOKEN?: string
  TELEGRAM_CHAT_ID?: string
  ALERT_WEBHOOK_URL?: string
}
