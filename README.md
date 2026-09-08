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
| [`apps/web`](apps/web)                                                       | The embedded admin app — Polaris **web components** on the CDN App Home stack (App Bridge + `polaris.js`), Drizzle + SQLite session storage.   |

The full design is recorded in [`docs/adr/0001`–`0017`](docs/adr), the build plan
in [`docs/BUILD-PLAN.md`](docs/BUILD-PLAN.md), and the Cloudflare deploy plan in
[`docs/DEPLOY-PLAN.md`](docs/DEPLOY-PLAN.md).

## Prerequisites

- **Node 22** (`.nvmrc`) and **pnpm 10** (`corepack enable`)
- A **Shopify Partner account** + a development store, and the
  [Shopify CLI](https://shopify.dev/docs/api/shopify-cli)

## Quick start

```bash
pnpm i
pnpm db:up          # creates .data/dev.sqlite, runs migrations, seeds
shopify app dev      # runs apps/web's Vite directly, tunnels, injects env
```

`shopify app dev` injects `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SCOPES`,
`HOST`, and `PORT` directly. Everything else comes from **one `.env` at the repo
root** (next to `shopify.app.toml` — this is where `shopify app env pull` writes).
Copy `.env.example` to `.env` (the default `DATABASE_URL` is fine); add the
`SHOPIFY_*` values too if you run `pnpm --filter web dev` / `start` without the
CLI. Vite forwards the root `.env` onto `process.env` for the app; `drizzle-kit`,
`db:seed`, and `start` load it themselves.

## Scripts

| Command                                       | What it does                                                                                   |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `pnpm dev`                                    | `turbo run dev` — every workspace (the multi-workspace path; `shopify app dev` bypasses Turbo) |
| `pnpm build`                                  | `vite build` + `nitro()` Node preset → `apps/web/.output/`                                     |
| `pnpm typecheck`                              | `tsc --noEmit` per workspace                                                                   |
| `pnpm lint`                                   | oxlint                                                                                         |
| `pnpm format` / `pnpm format:check`           | Prettier                                                                                       |
| `pnpm db:up`                                  | `.data/` SQLite file → migrate → seed                                                          |
| `pnpm db:generate` / `db:migrate` / `db:seed` | Drizzle Kit migration workflow                                                                 |
| `pnpm db:studio`                              | Drizzle Studio (browse the `session` table) at `https://local.drizzle.studio`                  |
| `pnpm deploy:staging`                         | Workers build + `wrangler deploy` via `wrangler.jsonc` (see Deployment)                         |
| `pnpm deploy:production`                      | Workers build + `wrangler deploy` via `wrangler.production.jsonc`                               |

Node production serve (local smoke): `pnpm build` then
`node apps/web/.output/server/index.mjs`.

## Deployment

Hosted target is **Cloudflare Workers** (Terraform for account resources, Wrangler
for code). Local `shopify app dev` stays on Node and does **not** need a
Cloudflare account.

Follow the ordered CLI runbook in [`docs/DEPLOY-PLAN.md`](docs/DEPLOY-PLAN.md).
Decisions: ADRs [0011](docs/adr/0011-workers-build-and-runtime-adapter.md)–[0017](docs/adr/0017-local-dev-and-runtime-seam.md).

CI/CD is out of scope until a manual `terraform apply` + `wrangler deploy` from
this machine has worked.

## License

MIT — see [LICENSE](LICENSE).
