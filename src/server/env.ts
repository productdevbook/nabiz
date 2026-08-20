import { isLang } from "../lib/i18n.ts"
import { openSqlite, type SqliteDb } from "../lib/sqlite.ts"

// The page is bundled by Astro and this file is loaded again by the
// runner beside it; one process must still mean one database handle.
const held = globalThis as { nabizDb?: SqliteDb }

// The container names its own path; a checkout has no /data to fail on.
export const DB_PATH = process.env.NABIZ_DB ?? "./nabiz.db"

export const db: SqliteDb = (held.nabizDb ??= openSqlite(DB_PATH))

// LANG is a POSIX variable before it is ours: a base image setting it to
// C.UTF-8 must not count as an answer to which of the six languages this
// page speaks.
const posix = process.env.LANG ?? ""

/** What `cloudflare:workers` hands the pages on the edge, read from the
 *  process instead. */
export const env = {
  DB: db,
  LANG: process.env.NABIZ_LANG ?? (isLang(posix) ? posix : undefined),
  TITLE: process.env.NABIZ_TITLE ?? process.env.TITLE,
  ADMIN_TOKEN: process.env.ADMIN_TOKEN,
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,
  ALERT_WEBHOOK_URL: process.env.ALERT_WEBHOOK_URL,
}
