# Working on nabiz

nabiz is a status page with two runtimes and one source. On Cloudflare it
is one Worker: an Astro site rendered on the Worker, a cron on the same
Worker doing the probing, history in D1. `src/worker.ts` is the entry —
`fetch` goes to Astro, `scheduled` to the probes. On a server it is one
process: the same Astro output through the Node adapter, an interval where
the cron was, SQLite where D1 was. `src/server/index.ts` is that entry.

## The map

    src/worker.ts        the Worker entry: Astro handler + cron
    src/server/          the server entry: http + static + interval,
                         and env.ts, which answers `cloudflare:workers`
                         off the edge
    src/pages/           Astro routes; index.astro is the page,
                         *.ts files are the JSON/text endpoints
    src/lib/             everything testable: probe, store, tick (one
                         probe round), db (the database interface),
                         sqlite (that interface over a file), shape
                         (view models), render (HTML strings), api
                         (responses), i18n, markdown, alert
    src/styles.css       the whole design system (Tailwind v4, CSS-first)
    schema.sql           the database, additively; changes are ALTERs
                         listed in docs/UPGRADING.md
    Dockerfile           the container: build stage, then the built site
    compose.yaml         one service, one volume
    deploy/k8s/          plain manifests, one replica by design
    docs/                one page per subject; the README is a landing
                         page and links to them rather than growing
    test/                bun tests against a fake D1 and a real SQLite,
                         and page.test.ts, which runs the page's own
                         inline script in a DOM

## Commands

    bun run dev          dev server on :4321 with a local D1 (miniflare)
    bun run check        typecheck + lint + format check + tests — run
                         before every commit; CI runs this plus both builds
    bun run build        astro build; also the only full typecheck of
                         .astro files
    bun run build:server the same source for the Node adapter
    bun run start        run the server target from a checkout
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
- **`src/lib/` knows no platform.** It speaks the narrow `Db` interface
  from `src/lib/db.ts`, which D1 satisfies as it is and SQLite is made to.
  A `D1Database` type or a `cloudflare:` import below `src/lib/` is a bug;
  so is a second copy of a rule that already lives there.
- Relative imports carry the `.ts` extension: Node runs the server entry
  straight from source and does not guess extensions.
- Comments only for what the code cannot say. Commit messages say why.
- **Commits are Conventional Commits**: `type(scope): summary`, with the
  scope optional and the summary in this repository's voice — a sentence
  that says what changed, not a label. `feat`, `fix`, `perf`, `refactor`,
  `docs`, `test`, `build`, `ci`, `chore`; `!` after the type for a break.
  The body is still where the why goes.

      fix(shape): a row that says it is grouped is never published by name
      perf(store): every read of the checks table asks for a window of time
      docs(api): the page says what the code does, not what it once did

  Pull request titles are the same shape.
- Release notes are headings and bullets, one line each, scannable in ten
  seconds. The reasoning belongs in the commit message, not the release.

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
- `tsc` is scoped to `tsconfig.lib.json` (lib + server + tests) and types
  them with `@types/node`; the root `tsconfig.json` types the pages and the
  worker with `@cloudflare/workers-types`. The two sets of globals cannot
  share a project — that is why there are two.
- Astro components are type-checked by the build, not by tsc; `bun run
  build:server` is the second half of that check.
- Formatting is oxfmt with `semi: false`; lint is oxlint. Both refuse
  warnings, locally and in CI — `bun run check` is what CI runs.
