# Local dev model and the app-level runtime seam

**Revises [ADR 0005](0005-data-layer.md)** (`pnpm db:up`) and
**[ADR 0008](0008-monorepo-scaffold-and-tooling.md)** (Docker as a prerequisite).

Decision: ENG-2373.

## Decision

1. **Runtime locally: Node.** `shopify app dev` still runs `apps/web` Vite
   directly (TanStack Start SSR, not Miniflare). No `wrangler login`, no
   Cloudflare account. Maintainers own `CLOUDFLARE=1` preview / deploy.
2. **`docker-compose.yml` is removed.** Local DB is a SQLite file at
   `.data/dev.sqlite` (gitignored). `pnpm db:up` = `mkdir -p .data` →
   `db:migrate` → `db:seed`. Same one-command bootstrap, no container.
3. **App-level seam** (all in `apps/web`, selected by Vite alias when
   `CLOUDFLARE=1`):

   | Concern | Local (Node) | Workers |
   |---|---|---|
   | Shopify API adapter | `@shopify/shopify-api/adapters/node` in `platform.ts` | `@shopify/shopify-api/adapters/cf-worker` in `platform.cf.ts` |
   | Drizzle + `SessionStorage` | `app/db/client.ts` (better-sqlite3) | `app/db/client.d1.ts` (`env.DB`) |
   | Auth coordination | in-memory default | `app/auth/coordination.kv.ts` (`env.AUTH_KV`) |
   | Webhooks | sync (ADR 0014) | sync (ADR 0014) |

   `app/platform.ts` / `app/platform.cf.ts` is the single alias target
   `shopify.server.ts` imports. A future AWS/GCP target adds `platform.lambda.ts`
   (or similar) and another Vite flag — not a rewrite of routes or the package.
4. **Secrets locally.** Unchanged: root `.env` + CLI injection. `.dev.vars` is
   documented for `CLOUDFLARE=1 vite preview` / `wrangler dev` only.
5. **What changes vs today.** Docker is no longer a prerequisite. `drizzle-kit
   studio` talks to the SQLite file. `pnpm --filter web dev` without the CLI
   still works. `pnpm --filter web start` still serves the Node `.output/` build.
   Worker-parity preview is `CLOUDFLARE=1` + Wrangler, optional, maintainer-only.

## Why

- Map standing preference: app-developer DX must not require Cloudflare.
- File SQLite is a closer dialect match to D1 than keeping Postgres locally.

## Considered and rejected

- **Miniflare as the default `vite dev`.** Changes the CLI tunnel loop and
  implies Wrangler. Available later as `CLOUDFLARE=1 vite dev` if someone wants
  it; not the default.
- **Keep Docker Postgres "for parity".** Two dialects in one starter. D1 is the
  data layer now.
- **Package-level `Lock` / `Queue` interfaces.** Cloudflare glue stays in the
  app; the only package addition is the tiny `AuthCoordinationStore` (ADR 0013).

## Consequences

- README drops Docker. Prerequisites are Node 22 + pnpm 10 + Shopify CLI.
- `DATABASE_URL` default is `file:../../.data/dev.sqlite` from `apps/web`.
