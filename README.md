# shopify-tanstack-starter

An embedded Shopify admin app built on **TanStack Start**, with the same Shopify
_capabilities_ that `@shopify/shopify-app-react-router` gives a React Router app:
token-exchange + managed-install auth, a populated server-fn context
(`admin` / `session` / `scopes` / `billing`), `unauthenticated.{admin,storefront}`
offline clients, and webhook handling.

Two workspaces in one pnpm + Turborepo monorepo:

| Path                                                                         | What it is                                                                                                                                     |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| [`packages/shopify-app-tanstack-start`](packages/shopify-app-tanstack-start) | The framework-glue package. Consumed as TypeScript source (not published).                                                                     |
| [`apps/web`](apps/web)                                                       | The embedded admin app — Polaris **web components** on the CDN App Home stack (App Bridge + `polaris.js`), Drizzle + Postgres session storage. |

The full design is recorded in [`docs/adr/0001`–`0009`](docs/adr) and the
execution plan in [`docs/BUILD-PLAN.md`](docs/BUILD-PLAN.md).

## Prerequisites

- **Node 22** (`.nvmrc`) and **pnpm 10** (`corepack enable`)
- **Docker** — for the local Postgres (`docker-compose.yml`)
- A **Shopify Partner account** + a development store, and the
  [Shopify CLI](https://shopify.dev/docs/api/shopify-cli)

## Quick start

```bash
pnpm i
pnpm db:up          # starts Postgres, runs migrations, seeds
shopify app dev      # runs apps/web's Vite directly, tunnels, injects env
```

`shopify app dev` injects `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SCOPES`,
`HOST`, and `PORT`. For a bare `pnpm dev` without the CLI, copy
`apps/web/.env.example` to `apps/web/.env` and fill in the values (plus
`DATABASE_URL`, which `pnpm db:up` expects).

## Scripts

| Command                                       | What it does                                                                                   |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `pnpm dev`                                    | `turbo run dev` — every workspace (the multi-workspace path; `shopify app dev` bypasses Turbo) |
| `pnpm build`                                  | `vite build` + `nitro()` Node preset → `apps/web/.output/`                                     |
| `pnpm typecheck`                              | `tsc --noEmit` per workspace                                                                   |
| `pnpm lint`                                   | oxlint                                                                                         |
| `pnpm format` / `pnpm format:check`           | Prettier                                                                                       |
| `pnpm db:up`                                  | Postgres container → migrate → seed                                                            |
| `pnpm db:generate` / `db:migrate` / `db:seed` | Drizzle Kit migration workflow                                                                 |
| `pnpm db:studio`                              | Drizzle Studio (browse the `session` table) at `https://local.drizzle.studio`                  |

Production serve: `pnpm build` then `node apps/web/.output/server/index.mjs`.

## Deployment

The starter targets **Node 22** (`nitro({ preset: 'node-server' })`). It is kept
runtime-agnostic where it counts so a later Cloudflare / AWS / GCP effort is a
preset + adapter swap. See [`docs/adr/0009-runtime-assumptions-and-deployment-portability.md`](docs/adr/0009-runtime-assumptions-and-deployment-portability.md)
for the per-target change tables and the two commented swap points
(`apps/web/app/db/client.ts`, `apps/web/vite.config.ts`).

CI/CD, automated tests, and infrastructure-as-code are out of scope for this
template.

## License

MIT — see [LICENSE](LICENSE).
