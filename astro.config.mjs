// Astro on Cloudflare, whole: the page renders on the worker, the cron
// lives in the same worker (src/worker.ts), and D1 arrives as a binding —
// in dev too, through the platform proxy.
import cloudflare from "@astrojs/cloudflare"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "astro/config"

export default defineConfig({
  output: "server",
  adapter: cloudflare({
    platformProxy: { enabled: true },
    workerEntryPoint: { path: "src/worker.ts" },
  }),
  vite: {
    plugins: [tailwindcss()],
    server: { allowedHosts: [".trycloudflare.com"] },
  },
})
