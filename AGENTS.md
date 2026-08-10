# Working on nabiz

nabiz is a status page as one Cloudflare Worker: an Astro site rendered on
the Worker, a cron on the same Worker doing the probing, history in D1.
`src/worker.ts` is the entry — `fetch` goes to Astro, `scheduled` to the
probes.

## The map

    src/worker.ts        the Worker entry: Astro handler + cron
    src/pages/           Astro routes; index.astro is the page,
                         *.ts files are the JSON/text endpoints
    src/lib/             everything testable: probe, store (D1),
                         shape (view models), render (HTML strings),
                         api (responses), i18n, markdown, alert
    src/styles.css       the whole design system (Tailwind v4, CSS-first)
    schema.sql           the database, additively; changes are ALTERs
                         listed in README's upgrade section
    test/                bun tests against a fake D1

## Commands

    bun run dev          dev server on :5173 with a local D1 (miniflare)
    bun run check        typecheck + lint + format check + tests — run
                         before every commit; CI runs this plus the build
    bun run build        astro build; also the only full typecheck of
                         .astro files
    bun run deploy       astro build + wrangler deploy -c dist/server/wrangler.json

The local D1 lives under `.wrangler/state/`; create it once with
`bunx wrangler d1 execute nabiz --local --file schema.sql`.

## Rules that are not preferences

- **This repository is public.** No real hostnames, tokens, database ids,
  chat ids or webhook addresses anywhere — code, comments, tests, commit
  messages. `example.com` and placeholders only. Monitors are D1 rows
  precisely so that deployments keep their names out of this repo.
- **Every user-facing string goes through `src/lib/i18n.ts`, in all five
  languages at once** (en, tr, de, es, fr). A key missing from one
  language is a type error; do not work around it.
- **Stay inside Cloudflare's free tier**: one cron a minute, no external
  service a probe depends on, no dependency needing bundler config.
- Comments only for what the code cannot say. Commit messages say why.

## The design system (src/styles.css)

Two laws cover every corner; do not invent new radii:

- Outer surfaces (cards, panels, dialog, callouts) are 20px. Everything
  one level inside shares the concentric **8px** (= 20 − 12 inset): the
  well, every icon tile, the textarea.
- Icon tiles are a soft tint of their hue behind the hue itself
  (`color-mix(in srgb, var(--hue) 14%, var(--panel))`) — never
  white-on-solid. Pills and chips are capsules (`rounded-full`).

Colors are green-tempered neutrals defined three times (`:root`, the
`prefers-color-scheme: dark` block guarded with `:not([data-theme="light"])`,
and `[data-theme="dark"]`) — a color defined in only one of them is a bug.
Icons are Lucide paths inlined in the markup; no icon dependency.

## Gotchas that already cost time

- Runtime bindings come from `import { env } from "cloudflare:workers"` —
  `Astro.locals.runtime` is gone since adapter v6.
- `src/worker.ts` must export the `{ fetch, scheduled }` object shape;
  the Astro dev runner rejects other shapes.
- The vital chip's number uses checks from the last hour; its waveform
  uses hourly averages of the last 24h (`src/lib/store.ts`). Old fixture
  data falls out of both windows and the chip rightly disappears —
  reseed with fresh timestamps before concluding it broke.
- `tsc` is scoped to `tsconfig.lib.json` (lib + tests). Astro components
  are type-checked by the build, not by tsc.
- Formatting is oxfmt with `semi: false`; lint is oxlint. CI runs both
  with `--deny-warnings` and `--check`.
