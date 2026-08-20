// The worker's environment. It goes inside Cloudflare's own namespace,
// which is where `import { env } from "cloudflare:workers"` reads its type
// from — declared globally instead, as `wrangler types` used to write it,
// every page saw an empty Env and nothing said so.
declare namespace Cloudflare {
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
}

// The adapter's handler types ask for `Env` by that name.
type Env = Cloudflare.Env
