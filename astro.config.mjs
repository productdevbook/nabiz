// Astro on Cloudflare, whole: the page renders on the worker, the cron
// lives in the same worker (src/worker.ts), and D1 arrives as a binding —
// in dev too, through the platform proxy.
//
// NABIZ_TARGET=node builds the same site for a server somebody owns: the
// Node adapter, and `cloudflare:workers` answered by src/server/env.ts,
// which reads the process instead of the platform.
import { fileURLToPath } from "node:url"

import cloudflare from "@astrojs/cloudflare"
import node from "@astrojs/node"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig, passthroughImageService } from "astro/config"

const server = process.env.NABIZ_TARGET === "node"
const envForServer = fileURLToPath(new URL("./src/server/env.ts", import.meta.url))

const serverEnv = {
  name: "nabiz-server-env",
  enforce: "pre",
  resolveId: (id) => (id === "cloudflare:workers" ? envForServer : null),
}

export default defineConfig({
  output: "server",
  // No sessions anywhere in this page; without saying so the Cloudflare
  // adapter writes a KV binding with no namespace into the deploy config.
  session: false,
  adapter: server ? node({ mode: "middleware" }) : cloudflare({
    platformProxy: { enabled: true },
    workerEntryPoint: { path: "src/worker.ts" },
  }),
  // Off the edge there is no image service to reach for, and nabiz asks
  // nothing of one.
  ...(server ? { image: { service: passthroughImageService() } } : {}),
  vite: {
    plugins: server ? [tailwindcss(), serverEnv] : [tailwindcss()],
    server: { allowedHosts: [".trycloudflare.com"] },
    ...(server
      ? { build: { rollupOptions: { external: ["bun:sqlite", "node:sqlite"] } } }
      : {}),
  },
})
