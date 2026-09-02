# Monorepo scaffold & tooling

The repo scaffold: pnpm workspace, Turborepo pipeline, TypeScript config, tool
configs, `shopify app dev` integration, and `shopify.app.toml`. Grounded in the
ENG-2321 TanStack Start model research and the ENG-2335 prototype's config files;
picks up loose ends handed over by ENG-2330 and ENG-2331.

## Workspace layout

```
/                             pnpm-workspace.yaml, turbo.json, tsconfig.base.json,
                              .oxlintrc.json, .prettierrc, .nvmrc, docker-compose.yml,
                              shopify.app.toml, .env.example (root: none), README.md
apps/web/                     the embedded admin app  (Vite + TanStack Start + nitro())
  app/                        routes/, db/ (ENG-2329), types/ (ENG-2331), shopify.config.ts
  shopify.web.toml
packages/shopify-app-tanstack-start/   the framework-glue package (ENG-2325)
  src/                        server/, react/, webhooks/, clients/, adapters/
```

- `pnpm-workspace.yaml` globs: `apps/*` + `packages/*`. Two members today
  (`apps/web`, `packages/shopify-app-tanstack-start`); names fixed by ENG-2325 /
  ENG-2329 / ENG-2331.
- `.npmrc`: `save-exact=true`, `dedupe-peer-dependents=true`,
  `auto-install-peers=true`.
- **pnpm catalog** (`catalog:` in `pnpm-workspace.yaml`) is the single version
  authority for every dependency shared by the app and the package: `react` /
  `react-dom` (19.x), `@tanstack/react-start` / `@tanstack/react-router`,
  `@shopify/shopify-api`, `@shopify/shopify-app-session-storage*`, `typescript`,
  `vite`. The package lists app-facing libs as `peerDependencies` with
  `catalog:`; the app satisfies them.

## Package consumption — JIT source, no build

`packages/shopify-app-tanstack-start` is never published (ENG-2325). It is
consumed as **TypeScript source**:

- `exports` subpaths (`.`, `/react`, `/webhooks`, `/clients`, `/node`) point at
  `./src/**/index.ts` — no `dist/`, no build step in the task graph.
- `apps/web`'s Vite compiles it; the app's `vite.config.ts` sets
  `ssr.noExternal: ['shopify-app-tanstack-start']` so the workspace source is
  transformed rather than treated as an external CJS/ESM package.
- `typecheck` is a per-workspace `tsc --noEmit`. **No TypeScript project
  references** (`references` array) — two workspaces do not need `tsc -b`
  orchestration; Turbo already sequences the graph.
- `tsconfig.base.json` at the root carries the prototype's options: `strict`,
  `moduleResolution: "Bundler"`, `module: "ESNext"`, `target: "ES2024"`,
  `jsx: "react-jsx"`, `noEmit`, `isolatedModules`, `verbatimModuleSyntax`,
  `skipLibCheck`, `forceConsistentCasingInFileNames`. Each workspace's
  `tsconfig.json` extends it; `apps/web` adds `paths: { "~/*": ["./app/*"] }`.

Switching to a published/compiled package later is a `tsup` config plus an
`exports` swap to `dist` — no call-site changes.

## Node + pnpm

- **Node 22.** `@shopify/shopify-api@14` and `@shopify/shopify-app-react-router`
  both require `>=22`; TanStack Router only needs `>=20.19`, so 22 is the binding
  constraint. `.nvmrc` = `22`; root `engines.node` = `>=22`.
- **pnpm 10.x, pinned exact** in `packageManager` with its `sha512` (as the
  prototype), Corepack-managed. `engines.pnpm` = `>=10`.
- No `.node-version` — `.nvmrc` covers nvm / fnm / asdf.

## Lint & format

- **Oxlint only.** `.oxlintrc.json`: `categories: { correctness: "error",
  suspicious: "warn" }`, plugins `["react", "typescript", "import", "jsx-a11y"]`.
  Accepts losing `@tanstack/eslint-plugin-router` / `-query` — not worth a second
  lint runner in a starter.
- `no-restricted-imports` blocks `@shopify/polaris` and `@shopify/polaris-icons`
  (ENG-2330) with a message pointing at the CDN web-component approach.
- **Prettier**: `.prettierrc` = `{ "singleQuote": true, "semi": true,
  "trailingComma": "all", "printWidth": 100 }`. `.prettierignore`:
  `app/routeTree.gen.ts`, `app/types/*.generated.d.ts`, `.output`, `.nitro`,
  `dist`, `app/db/migrations/**`.
- Root scripts: `lint` (oxlint), `format`, `format:check`. `format:check` is its
  own Turbo task. No husky / pre-commit hooks (out of this ticket's scope).

## `shopify app dev` integration

- `shopify.app.toml` at the repo root; `apps/web/shopify.web.toml` defines the
  one web process: `roles = ["frontend", "backend"]`,
  `[commands] dev = "pnpm dev"`. The Shopify CLI runs that command with
  `apps/web` as cwd and injects `PORT`, `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`,
  `SCOPES`, `HOST` into its environment. **Turbo is not in the loop for
  `shopify app dev`** — it runs `apps/web`'s Vite directly.
- Root `pnpm dev` (Turbo `dev`) is the separate "run every workspace" path.
- **Env.** `apps/web/.env` (gitignored) holds `DATABASE_URL` and — for a bare
  `pnpm dev` without the CLI — `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` /
  `SCOPES`. `apps/web/.env.example` is committed. Server-only vars; **no
  `VITE_`-prefixed public mirror**.
- The public API key reaches `__root` (ENG-2330's literal `<meta
  shopify-api-key>`) via a **server-only read** of `process.env.SHOPIFY_API_KEY`
  in the root route, passed to `head` — not a `VITE_` build-time inline.

## `shopify.app.toml`

```toml
client_id = "…"
application_url = "https://example.com"        # placeholder
embedded = true
name = "shopify-tanstack-starter"

[access_scopes]
scopes = "write_products"                       # the productCreate demo — ENG-2331

[auth]
redirect_urls = ["https://example.com/auth"]    # minimal; token exchange doesn't use the callback

[webhooks]
api_version = "2025-10"                          # keep in sync with app/shopify.config.ts

[[webhooks.subscriptions]]
topics = ["app/uninstalled"]
uri = "/webhooks/app.uninstalled"

[[webhooks.subscriptions]]
topics = ["app/scopes_update"]
uri = "/webhooks/app.scopes_update"

[webhooks.privacy_compliance]
customer_data_request_url = "/webhooks/compliance/customers-data-request"
customer_deletion_url    = "/webhooks/compliance/customers-redact"
shop_deletion_url        = "/webhooks/compliance/shop-redact"

[build]
automatically_update_urls_on_dev = true
include_config_on_deploy = true
```

- Webhook subscriptions are **toml-declared only** (ENG-2328) — no `webhooks`
  config field, no `afterAuth` registration.
- Compliance URLs resolve to the `webhooks/compliance.$` splat route (ENG-2331).
- **`[access.admin] embedded_app_direct_api_access` is omitted** — the starter
  does no client-side Admin GraphQL (ENG-2327); declaring it only silences a
  warning for a capability that isn't used.

## The single `apiVersion` source

`app/shopify.config.ts` exports one dated constant, `API_VERSION` (a specific
version, **not** `LATEST_API_VERSION` — codegen must be reproducible). Imported by:

- the `createShopifyApp` runtime config, and
- `.graphqlrc.ts` (schema + generated types are version-locked).

`shopify.app.toml`'s `[webhooks] api_version` is the one copy that cannot import a
TS module; it carries a `# keep in sync with app/shopify.config.ts` comment.

## Turbo pipeline

| task | `dependsOn` | notes |
|---|---|---|
| `routes:generate` | — | `tsr generate` → `app/routeTree.gen.ts` |
| `graphql-codegen` | — | ENG-2331 → `app/types/admin.*.d.ts` |
| `dev` | — | persistent, uncached. `apps/web` `predev` runs `routes:generate` + `graphql-codegen` + `db:migrate` (ENG-2329) |
| `build` | `^build`, `routes:generate`, `graphql-codegen` | `vite build` → `.output/` via `nitro()` Node preset |
| `typecheck` | `routes:generate`, `graphql-codegen` | `tsc --noEmit` per workspace |
| `lint` | — | oxlint |
| `format:check` | — | prettier |
| `db:generate` / `db:migrate` / `db:seed` | — | ENG-2329 |

- `app/routeTree.gen.ts` is **gitignored** — a build artifact regenerated on
  every `dev` / `build`.
- `app/types/admin.*.generated.d.ts` is **committed** (ENG-2331) — a fresh
  `pnpm i && pnpm typecheck` must pass with no Shopify schema fetch.
- Route file convention: **directory-nested** (`routes/_authenticated/app/…`,
  `routes/webhooks/…`), documented in a comment, enforced by nothing — TanStack
  Router's generator accepts flat and nested simultaneously.
- **Prod serve**: `vite build` + `nitro()` default Node preset producing
  `.output/`; `start = node .output/server/index.mjs`. The ENG-2335 prototype
  observed the prod output still referencing the dev virtual client entry — most
  likely a prototype `srcDirectory` misconfig (`src` vs `app`); it is an
  **implementation-time verification item** for the build workstream, not a new
  ticket and not deferred to ENG-2333.

## Repo hygiene

`.gitignore` (`node_modules`, `.output`, `.nitro`, `dist`, `.turbo`, `.env*`
except `.env.example`, `app/routeTree.gen.ts`, `.DS_Store`), `.editorconfig`,
root `README.md` (clone-and-go: `pnpm i` → `pnpm db:up` → `shopify app dev`),
`LICENSE`.

## Why

- **pnpm catalog over duplicated ranges.** The app and the package must agree on
  React, TanStack, and `@shopify/shopify-api` exact versions or the peer graph
  and the `Session` types drift. A catalog is one line per shared dep and one
  place to bump.
- **JIT source over a compiled package.** One consumer, no publish intent. A
  build step buys `dist` isolation nobody needs yet and slows the inner loop.
  `ssr.noExternal` is one line; project references would be several `tsconfig`s
  and a `tsc -b` invariant to keep green.
- **Node 22, not 20.** The Shopify packages hard-require it; pinning lower just
  defers a confusing install failure.
- **Oxlint only.** A starter should have one fast lint command. The TanStack
  ESLint plugins are nice-to-have, not worth a second toolchain and a second
  config format in a template people clone and read.
- **`shopify app dev` bypasses Turbo.** The CLI owns the dev process's env
  injection and tunnel; wrapping it in `turbo run` adds a layer that can only
  swallow signals and env. Turbo's `dev` is for the multi-workspace case.
- **API key read server-side, not `VITE_`.** The CLI injects `SHOPIFY_API_KEY`
  without the prefix; a `VITE_` mirror is a second env var to keep in sync and
  bakes the key into the client bundle at build time instead of reading it per
  deploy.
- **One dated `API_VERSION` constant.** Three unsynchronised copies is a
  silent-drift bug: codegen types, runtime requests, and webhook payloads would
  disagree. `LATEST_API_VERSION` would make codegen output move under CI.
- **`embedded_app_direct_api_access` omitted.** ENG-2327 has no client-side
  Admin client; enabling direct API access advertises a capability the starter
  doesn't implement.

## Considered and rejected

- **`tsup`-compiled package + TS project references.** Rejected for now — see
  Why. Documented as the one-step migration if the package is ever published.
- **Oxlint + a thin ESLint for TanStack plugins.** Rejected: two runners, two
  config dialects, marginal rules.
- **`VITE_SHOPIFY_API_KEY` public env.** Rejected: duplicate of the CLI-injected
  var, build-time inline instead of per-request.
- **`LATEST_API_VERSION` everywhere + document the toml sync.** Rejected:
  non-reproducible codegen; a schema change silently moves generated types.
- **`shopify.web.toml` `dev = "pnpm turbo dev --filter web"`.** Rejected: Turbo
  between the CLI and Vite adds nothing and risks signal/env loss.
- **`shopify.app.toml` at `apps/web/`.** Rejected: the CLI resolves the app
  config from the repo root; keeping it there matches `shopify app` expectations
  and keeps the monorepo root as the single control surface.
- **Committing `routeTree.gen.ts`.** Rejected: pure build artifact, noisy diffs;
  regenerated on every `dev`/`build` and in `predev`.

## Consequences

- **ENG-2333** inherits a clean starting point: `nitro()` Node preset, the
  "no `node:*` in shared package code" rule (ENG-2325), and env-read-per-request
  (ENG-2321). Its job is the deployment-agnostic hand-off note, not tooling.
- **ENG-2334** — the repo/tooling workstream input is complete; the build plan
  can now order `pnpm i` → codegen/routes:generate → `db:up` → `shopify app dev`.
- A fresh clone needs a reachable Postgres before `shopify app dev` is useful
  (ENG-2329); `README` leads with `pnpm db:up`.
- The prod-serve path is specified but **unverified** — the build workstream must
  confirm `node .output/server/index.mjs` serves the built client, not the dev
  entry.
- `write_products` is the only requested scope; adding Admin surface later means
  editing `shopify.app.toml` `scopes` and re-running `shopify app dev` (managed
  install re-prompts).
