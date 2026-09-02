# `shopify-tanstack-starter` — Build Plan

This is the execution plan produced by the [Shopify TanStack Start Starter — Build
Plan](https://linear.app/extend-commerce/issue/ENG-2320/shopify-tanstack-start-starter-build-plan)
wayfinding map (ENG-2320). Every decision it depends on is already made and
recorded in `docs/adr/0001`–`0009`; this document turns those decisions into an
ordered, workstream-partitioned build that **N agents can pick up in parallel with
minimal file collision**.

Nothing here is a fresh decision. Where a step is ambiguous, its ADR is
authoritative — follow the ADR, don't re-litigate it.

---

## 1. What is being built

Two deliverables in one pnpm + Turborepo monorepo (repo already `git init`-ed):

| | Path | What it is |
|---|---|---|
| **The package** | `packages/shopify-app-tanstack-start` | Framework glue that gives a TanStack Start app the Shopify *capabilities* `@shopify/shopify-app-react-router` gives a React Router app: token-exchange + managed-install auth, a populated server-fn context (`admin` / `session` / `scopes` / `billing`), `unauthenticated.{admin,storefront}`, webhook handling. **Not published.** Consumed as TypeScript source. |
| **The app** | `apps/web` | An embedded Polaris **web-component** admin app on the CDN App Home stack (App Bridge + `polaris.js` from `cdn.shopify.com`), Drizzle + Postgres for session storage, mirroring the RR template's surface (index page with an Admin GraphQL demo, a second page, `<s-app-nav>`, `app/uninstalled` + `app/scopes_update` + GDPR webhooks). |

**Runtime now:** Node 22, `vite build` + `nitro({ preset: 'node-server' })` →
`.output/` → `node .output/server/index.mjs`. Runtime-agnostic where it counts so
a later Cloudflare / AWS / GCP effort is a preset + adapter swap (ADR 0009).
Deployment, CI, and automated tests are **out of scope** (see the map).

**Pinned versions** (ADR 0008 / ENG-2321): `@tanstack/react-start@1.168.49`,
`@tanstack/react-router@1.170.32`, React 19, Vite 8, `@shopify/shopify-api@14`,
`@shopify/shopify-app-session-storage@6`, `drizzle-orm@^0.45.0`, pnpm 10.x. The
pnpm **catalog** is the single version authority for everything shared by the app
and the package.

---

## 2. ADR index

| ADR | Ticket | Gist |
|---|---|---|
| [0001](adr/0001-tanstack-idiomatic-package-surface.md) | [Decide: package architecture & entry points](https://linear.app/extend-commerce/issue/ENG-2325) | `createShopifyApp(config)` returns TanStack-idiomatic primitives; `exports` `.` `/react` `/webhooks` `/clients` `/adapters/node`. |
| [0002](adr/0002-auth-boundary-and-bounce-control-flow.md) | [Decide: token-exchange + managed-install auth wiring](https://linear.app/extend-commerce/issue/ENG-2326) | Two-layer boundary: eager global `requestMiddleware` + `adminMiddleware` on Admin server fns; `_authenticated` `beforeLoad` bounce; RR-exact failure headers. |
| [0003](adr/0003-three-way-context-model.md) | [Decide: router context shape & capability clients](https://linear.app/extend-commerce/issue/ENG-2327) | Three-way split: `adminMiddleware` context `{admin,session,scopes,billing}` · `unauthenticated.*` · client-safe router context `{shop,isAuthenticated,queryClient}`. `admin.graphql()` returns parsed `{data,errors,extensions}`. |
| [0004](adr/0004-webhook-handling.md) | [Decide: webhook handling](https://linear.app/extend-commerce/issue/ENG-2328) | `shopify.handlers.webhooks` factory as server routes under `/webhooks`; HMAC via `api.webhooks.validate`; payload `{shop,topic,webhookId,apiVersion,payload,session?}`; toml-declared subscriptions only. |
| [0005](adr/0005-data-layer.md) | [Decide: data layer](https://linear.app/extend-commerce/issue/ENG-2329) | Reuse `DrizzleSessionStoragePostgres` against an app-owned verbatim-copied schema in `apps/web/app/db/`; `drizzle-kit` sole migration authority; docker-compose `postgres:17-alpine`. No example app table. |
| [0006](adr/0006-app-shell.md) | [Decide: app shell](https://linear.app/extend-commerce/issue/ENG-2330) | `__root` literal non-async head tags before `<HeadContent/>`; `suppressHydrationWarning` on `<html>`/`<head>`; pathless `_authenticated` gate + `<s-app-nav>` + `shopify:navigate` listener; raw `<s-page>`, no wrapper; `@shopify/polaris` forbidden. |
| [0007](adr/0007-app-routes-and-surface-parity.md) | [Decide: app routes & surface parity](https://linear.app/extend-commerce/issue/ENG-2331) | Route tree: `/` banner+redirect, `_authenticated/app/{index,additional}`, `auth/$`, `webhooks/*`. `productCreate`+`productVariantsBulkUpdate` demo via a `POST` `generateProduct()` server fn. Codegen → `apps/web/app/types/`. Owns the middleware path-exclusion list. |
| [0008](adr/0008-monorepo-scaffold-and-tooling.md) | [Decide: monorepo scaffold & tooling](https://linear.app/extend-commerce/issue/ENG-2332) | pnpm workspace + catalog; package consumed as JIT source (`ssr.noExternal`); Node 22; oxlint-only; `shopify app dev` runs `apps/web` Vite directly; one dated `API_VERSION` constant; Turbo graph. |
| [0009](adr/0009-runtime-assumptions-and-deployment-portability.md) | [Decide: runtime assumptions](https://linear.app/extend-commerce/issue/ENG-2333) | Node 22 + explicit `node-server` preset; adapter family (`/adapters/node` ships); package `src/**` lint-enforced runtime-agnostic; per-instance `afterAuth` double-fire is a documented single-instance limitation. |

---

## 3. Dependency graph & waves

```
WAVE 1        WAVE 2 (4-way parallel)              WAVE 3        WAVE 4
────────      ──────────────────────────           ────────      ────────
                WS1  Data layer  ───────────┐
WS0  Repo  ──┬─ WS2  Package: core + auth ──┼──►  WS5  App    ──►  WS7  App
   & tooling │  WS3  Package: context/     ─┤     shell           routes &
            │       clients                │                      codegen
            └─ WS4  Package: webhooks  ────┘
```

- **WS2 ↔ WS3** work in parallel to a shared written contract (the `adminMiddleware`
  context, ADR 0003) — neither blocks the other.
- **WS5** needs WS1 (the `sessionStorage` instance), WS2 (`requestMiddleware`, the
  `/react` entry), and WS3 (the client-safe router-context type).
- **WS7** is the most downstream: it wires WS2's `handlers.auth` + `adminMiddleware`,
  WS4's webhooks factory, and sits its routes under WS5's `_authenticated` layout.

A single agent can also walk the waves in order. The partition is about letting
several **not** collide, not forcing parallelism.

---

## 4. Workstreams

Each workstream lists the files it **owns** (no other workstream writes them),
what it **consumes**, the **integration points** it must honour (§5), ordered
**steps** each linking its ADR, and a **done-when**.

### WS0 — Repo & tooling  ·  ADR 0008, ADR 0009  ·  wave 1, blocks everything

**Owns (root):** `pnpm-workspace.yaml` (+ `catalog:`), `.npmrc`, `turbo.json`,
`tsconfig.base.json`, `.oxlintrc.json`, `.prettierrc`, `.prettierignore`,
`.nvmrc`, root `package.json` (`packageManager`, `engines`), `.gitignore`,
`.editorconfig`, `README.md`, `LICENSE`, `shopify.app.toml`,
`apps/web/app/shopify.config.ts` (the one-line `API_VERSION` constant — placed
here because WS5 and WS7 both need it in earlier waves).

**Steps**

1. `pnpm-workspace.yaml`: `packages: ['apps/*', 'packages/*']` + a `catalog:` block
   pinning `react`, `react-dom`, `@tanstack/react-start`, `@tanstack/react-router`,
   `@shopify/shopify-api`, `@shopify/shopify-app-session-storage`,
   `@shopify/shopify-app-session-storage-drizzle`, `typescript`, `vite`,
   `drizzle-orm`. `.npmrc`: `save-exact=true`, `dedupe-peer-dependents=true`,
   `auto-install-peers=true`. (ADR 0008 §Workspace layout)
2. `.nvmrc` = `22`; root `package.json` `packageManager: "pnpm@10.x+sha512…"`,
   `engines: { node: ">=22", pnpm: ">=10" }`, Corepack. (ADR 0008 §Node + pnpm)
3. `tsconfig.base.json`: `strict`, `moduleResolution: "Bundler"`, `module: "ESNext"`,
   `target: "ES2024"`, `jsx: "react-jsx"`, `noEmit`, `isolatedModules`,
   `verbatimModuleSyntax`, `skipLibCheck`, `forceConsistentCasingInFileNames`.
   (ADR 0008 §Package consumption)
4. `.oxlintrc.json`: `categories: { correctness: "error", suspicious: "warn" }`,
   plugins `["react","typescript","import","jsx-a11y"]`. **Two `no-restricted-imports`
   rules**: (a) block `@shopify/polaris` + `@shopify/polaris-icons` everywhere
   (ADR 0006); (b) block `node:*` and bare `crypto`/`fs`/`path`/`net`/`tls`/`stream`
   **scoped to `packages/*/src/**`** (ADR 0009). (ADR 0008 §Lint & format)
5. `.prettierrc` = `{ singleQuote, semi, trailingComma: "all", printWidth: 100 }`;
   `.prettierignore`: `**/routeTree.gen.ts`, `apps/web/app/types/*.generated.d.ts`,
   `**/.output`, `**/.nitro`, `**/dist`, `apps/web/app/db/migrations/**`.
6. `turbo.json` task graph (every other workstream wires its package scripts to
   these names): `routes:generate` (→ `app/routeTree.gen.ts`), `graphql-codegen`
   (→ `app/types/admin.*.d.ts`), `dev` (persistent, uncached), `build`
   (`dependsOn: ["^build", "routes:generate", "graphql-codegen"]`), `typecheck`
   (`dependsOn: ["routes:generate", "graphql-codegen"]`), `lint`, `format:check`,
   `db:generate`, `db:migrate`, `db:seed`. (ADR 0008 §Turbo pipeline)
7. `shopify.app.toml` at repo root (ADR 0008 §`shopify.app.toml`): `embedded = true`;
   `[access_scopes] scopes = "write_products"`; `[auth] redirect_urls =
   ["<appUrl>/auth"]`; `[webhooks] api_version = "<dated>"` with a
   `# keep in sync with apps/web/app/shopify.config.ts` comment;
   `[[webhooks.subscriptions]]` for `app/uninstalled` → `/webhooks/app.uninstalled`
   and `app/scopes_update` → `/webhooks/app.scopes_update`;
   `[webhooks.privacy_compliance]` → three `/webhooks/compliance/…` URLs;
   `automatically_update_urls_on_dev = true`, `include_config_on_deploy = true`.
   **Omit** `[access.admin] embedded_app_direct_api_access`.
8. `apps/web/app/shopify.config.ts`: `export const API_VERSION = '<dated>' as const;`
   — a specific dated version, **not** `LATEST_API_VERSION` (ADR 0008 §single apiVersion).
9. `.gitignore`: `node_modules`, `**/.output`, `**/.nitro`, `**/dist`, `.turbo`,
   `.env*` (keep `!.env.example`), `**/routeTree.gen.ts`, `.DS_Store`. `README.md`
   clone-and-go: `pnpm i` → `pnpm db:up` → `shopify app dev`. `README` also gets a
   short **"Deployment"** section linking `docs/adr/0009` (ADR 0009).

**Done when:** `pnpm i` succeeds at the root with empty `apps/web` and
`packages/shopify-app-tanstack-start` package.json stubs present; `pnpm turbo run
lint` runs (no targets yet is fine).

---

### WS1 — Data layer  ·  ADR 0005  ·  wave 2

**Owns:** `apps/web/app/db/schema.ts`, `apps/web/app/db/client.ts`,
`apps/web/app/db/seed.ts`, `apps/web/app/db/migrations/**`,
`apps/web/drizzle.config.ts`, the `db:*` scripts in `apps/web/package.json`, the
`postgres` service in root `docker-compose.yml`, and `pnpm db:up`.

**Consumes:** WS0 (workspace, `catalog:`, `db:*` Turbo task names).

**Steps**

1. `docker-compose.yml` at repo root: one `postgres:17-alpine`, named volume,
   `pg_isready` healthcheck. (ADR 0005 §Local Postgres)
2. Deps (via `catalog:`): `pg`, `drizzle-orm` (`drizzle-orm/node-postgres`),
   `drizzle-kit`, `@shopify/shopify-app-session-storage-drizzle`. **`drizzle-orm`
   pinned `^0.45.0`** — the `1.0.0-rc` line `ERESOLVE`s against the adapter peer.
   (ADR 0005 §Driver)
3. `schema.ts`: a **verbatim copy** of the adapter's canonical `postgres.schema.ts`
   — all 17 columns, canonical camelCase SQL identifiers, SQL table name `session`.
   No columns added or removed (the online-token / refresh-token columns stay
   even though offline-only auth leaves them null). (ADR 0005 §Session schema)
4. `client.ts`: `pg` `Pool` from `process.env.DATABASE_URL` +
   `drizzle(pool, { schema })`. Export `db` and
   `sessionStorage = new DrizzleSessionStoragePostgres(db, sessionTable)` — the
   constructor's second arg takes a single `as` cast (the branded table type is
   not exported). **Top-of-file comment: this module is a deployment portability
   swap point** — `pg` uses `node:net`/`node:tls`; a Workers target swaps a
   serverless/HTTP driver behind the same `SessionStorage`. (ADR 0005 §Why, ADR 0009)
5. `drizzle.config.ts` + `db:generate` (committed SQL) / `db:migrate`
   (`drizzle-kit migrate`) / `db:seed`. **No `drizzle-kit push`, no migrate-on-boot.**
   `seed.ts` is a documented bare stub — **no example app table**. `pnpm db:up` =
   `docker compose up -d --wait` → `db:migrate` → `db:seed`. (ADR 0005 §Migrations)

**Integration point produced:** **IP-2** — the `sessionStorage` instance.

**Done when:** `pnpm db:up` from a clean checkout brings up Postgres, applies the
`session` migration, and exits 0; `db` + `sessionStorage` import cleanly.

---

### WS2 — Package: core + config + auth  ·  ADR 0001, ADR 0002, ADR 0009  ·  wave 2

**Owns:** `packages/shopify-app-tanstack-start/package.json` (the `exports` map),
`tsconfig.json`, and under `src/`: `server/index.ts`, `server/config.ts`,
`server/shopify-app.ts`, `server/auth/*` (`request-middleware.ts`,
`admin-middleware.ts`, `token-exchange.ts`, `bounce.ts`, `exit-iframe.ts`,
`install-url.ts`, `headers.ts`), `server/routes/auth-splat.ts`, `adapters/node.ts`,
`react/index.ts` (the `/react` entry), `version.ts`.

**Consumes:** WS0. Coordinates with WS3 on **IP-4** (the `adminMiddleware` context)
and WS4 on **IP-3** (`createShopifyApp` return includes `handlers.webhooks`) — both
to the ADRs, no blocking.

**Steps**

1. `package.json` `exports`: `.` → `./src/server/index.ts`, `/react` →
   `./src/react/index.ts`, `/webhooks` → `./src/webhooks/index.ts` (file owned by
   WS4), `/clients` → `./src/clients/index.ts` (WS3), `/adapters/node` →
   `./src/adapters/node.ts`. **Documented-but-unshipped** slots `/adapters/web-api`
   and `/adapters/cf-worker` (ADR 0009). `peerDependencies` on the app-facing libs
   via `catalog:`. (ADR 0001 §exports, ADR 0009 §adapter family)
2. `server/config.ts`: the `AppConfigArg` type — RR's field **names kept**, minus
   legacy-OAuth `begin`/`callback`, `restResources`, `isCustomStoreApp`;
   `distribution` supports `AppStore` (default) + `SingleMerchant`, `ShopifyAdmin`
   throws. `deriveConfig`/`deriveApi` (`appUrl` → `hostName`, force
   `isEmbeddedApp: true`). (ADR 0001 §Config object)
3. `adapters/node.ts`: import `@shopify/shopify-api/adapters/node`, call
   `setAbstractRuntimeString(() => 'TanStack Start (Node)')`, export nothing. The
   package's own code imports `@shopify/shopify-api/adapters/web-api` for Web Crypto
   at baseline. (ADR 0009 §adapter family)
4. `server/auth/request-middleware.ts`: the eager global `createMiddleware`
   (type `'request'`) pipeline — `Bearer`/`?id_token` → `api.session.decodeSessionToken`
   → `getOfflineId(shop)` → `sessionStorage.loadSession` → if missing or within the
   `5*60*1000` ms expiry buffer: `api.auth.refreshToken` (expiring-offline path) else
   `api.auth.tokenExchange({ requestedTokenType: OfflineAccessToken })` →
   `storeSession` → `hooks.afterAuth` **once** (60s-TTL idempotent handler) →
   per-shop in-flight de-dupe `Map`. Puts `{ session, shop, sessionToken }` on
   server-only middleware context. **Never throws for missing auth.** Honours the
   path-exclusion list (**IP-7**, values owned by WS7). (ADR 0002 §Auth boundary)
   *In-memory `Map` + idempotent handler are per-process — documented
   single-instance limitation (ADR 0009), do not add a seam.*
5. `server/auth/admin-middleware.ts`: function middleware for Admin-touching
   `createServerFn`s — reload/ensure-active against the `Bearer`, build the `admin`
   client (from WS3's factory, **IP-4**), Admin `401` → `invalidateAccessToken` +
   retry response. Context: `{ admin, session, scopes, billing }` (`billing`
   contract reserved, helpers deferred). (ADR 0002 §layer 2, ADR 0003 §1)
6. `server/auth/{bounce,exit-iframe,install-url,headers}.ts`:
   `redirectToBouncePage` + `renderAppBridge` HTML (`shopify-reload`,
   `Cache-Control: no-store`, per-shop-sanitised CSP `frame-ancestors`);
   managed-install URL builders (used by `scopes.request`; the `login` builder is
   the **unused escape hatch** — ADR 0007); `addDocumentResponseHeaders` (CSP
   `frame-ancestors` for document responses — **IP-9**). RR-exact failure contract:
   `401` + `X-Shopify-Retry-Invalid-Session-Request: 1` for XHR, `302` for
   documents, `X-Shopify-API-Request-Failure-Reauthorize-Url` for scope reauth.
   (ADR 0002 §Failure contract)
7. `server/routes/auth-splat.ts`: the `/auth/$` handler factory — bounce /
   `session-token` / `exit-iframe`; non-embedded (`embedded !== '1'`) →
   `getEmbeddedAppUrl` redirect. **No shop-domain login page** (ADR 0007). Exposed
   as `shopify.handlers.auth`.
8. `server/shopify-app.ts` + `server/index.ts`: `createShopifyApp(config)` builds
   the `@shopify/shopify-api` instance internally and returns `{ api, sessionStorage,
   requestMiddleware, adminMiddleware, unauthenticated, registerWebhooks,
   addDocumentResponseHeaders, handlers: { webhooks, auth }, config }` (**IP-3**).
   `index.ts` also exports error types + a `boundary`-equivalent + enum re-exports
   from `@shopify/shopify-api`. (ADR 0001 §return value)
9. `react/index.ts` (**IP-10**): a `React.JSX.IntrinsicElements` shim `.d.ts`
   re-declaring the `<s-*>` custom elements (`@shopify/app-bridge-types` /
   `@shopify/polaris-types` augment the *legacy global* `JSX`, which React 19
   doesn't read) + a patch for the missing `rel` on `<s-link>`; plus a 5-line
   SSR-safe `useShopify()` returning the typed `window.shopify`. **No `<Page>`
   wrapper, no head helper, no provider.** (ADR 0006 §package `/react`)

**Integration points produced:** **IP-3** (`createShopifyApp` return), **IP-4**
(the `adminMiddleware` context — assembled with WS3), **IP-7** (`requestMiddleware`
+ exclusion-list hook), **IP-9** (`addDocumentResponseHeaders`), **IP-10** (`/react`).

**Done when:** `packages/shopify-app-tanstack-start` typechecks in isolation
against the ADR-0001 return type; `no-restricted-imports` for `node:*` passes over
`src/**`.

---

### WS3 — Package: context & capability clients  ·  ADR 0003  ·  wave 2

**Owns:** `packages/shopify-app-tanstack-start/src/clients/{admin.ts,storefront.ts,index.ts}`,
`src/unauthenticated.ts`, and the exported **client-safe router-context type**.

**Consumes:** WS0. Coordinates with WS2 (**IP-4**) and provides the `admin`
factory it uses.

**Steps**

1. `clients/admin.ts`: `admin` = a `GraphQLClient<AdminOperations>`;
   `admin.graphql(query, { variables, headers?, signal? })` returns **parsed**
   `{ data, errors, extensions }` — **not** RR's `Response`. Built from
   `new api.clients.Graphql({ session, apiVersion })` /
   `createAdminApiClient({ accessToken, storeDomain, apiVersion })`. `AdminOperations`
   is imported from `@shopify/admin-api-client` and augmented by the app's generated
   file (**IP-5**, WS7). (ADR 0003 §1)
2. `clients/storefront.ts`: `storefront` = `GraphQLClient<StorefrontOperations>`
   for the offline path only. **No authenticated `storefront`.** (ADR 0003 §capability parity)
3. `unauthenticated.ts`: `unauthenticated.admin(shop)` / `.storefront(shop)` →
   `{ session, admin | storefront }` via `ensureValidOfflineSession(shop)`
   (`loadSession(getOfflineId(shop))`, refresh-if-near-expiry when
   `future.expiringOfflineAccessTokens`, `SessionNotFoundError` if none). Callers:
   webhook handlers, cron, app-proxy. (ADR 0003 §2)
4. Export `type ShopifyRouterContext = { shop: string; isAuthenticated: boolean;
   queryClient: QueryClient }` — the **only** context that reaches the browser;
   never holds `session` or a token. Used by WS5's `createRootRouteWithContext`. (ADR 0003 §3)
5. `clients/index.ts` → the `/clients` export (admin + storefront factories
   together; **not** split further). (ADR 0003 §Split decision)

**Integration points produced:** **IP-4** (the `admin` factory feeding
`adminMiddleware`), **IP-5** (`GraphQLClient<AdminOperations>` typing), **IP-6-ctx**
(the client-safe router-context type).

**Done when:** `/clients` + `unauthenticated.*` typecheck; `admin.graphql`'s return
type is the parsed shape, asserted in a type-level test.

---

### WS4 — Package: webhooks  ·  ADR 0004  ·  wave 2

**Owns:** `packages/shopify-app-tanstack-start/src/webhooks/{handler.ts,register.ts,index.ts}`.

**Consumes:** WS0. Feeds **IP-3** (its factory is on the `createShopifyApp` return)
and produces **IP-8**.

**Steps**

1. `handler.ts`: the polymorphic `shopify.handlers.webhooks` factory — accepts a
   single `WebhookHandler` (per-topic route) **or** a topic-keyed map (splat route).
   `POST`-only. HMAC-validate via `api.webhooks.validate` over the **raw body**.
   Passes the handler `{ shop, topic, webhookId, apiVersion, payload, session? }`
   — **no `admin` client** (a handler that needs one calls
   `unauthenticated.admin(shop)` itself). (ADR 0004 §factory)
2. RR-exact response contract: `200` on success, `500` on handler throw, `401` on
   bad HMAC, `400` on malformed, `405` on non-`POST`. (ADR 0004 §contract)
3. `register.ts`: `registerWebhooks({ session })` — shipped as an **unused escape
   hatch**. Subscriptions are **toml-declared only** (WS0's `shopify.app.toml`);
   there is no `webhooks` config field and no `afterAuth` registration. (ADR 0004 §subscriptions)
4. `index.ts` → the `/webhooks` export.

**Integration point produced:** **IP-8** — the webhook handler payload contract.

**Done when:** the factory typechecks both call shapes; a unit-level HMAC pass/fail
returns `200`/`401`.

---

### WS5 — App: shell  ·  ADR 0006, ADR 0008  ·  wave 3

**Owns:** `apps/web/package.json` (app scripts + `predev`), `apps/web/vite.config.ts`,
`apps/web/shopify.web.toml`, `apps/web/.env.example`, `apps/web/tsconfig.json`,
`apps/web/app/router.tsx`, `apps/web/app/start.ts`, `apps/web/app/shopify.server.ts`,
`apps/web/app/routes/__root.tsx`, `apps/web/app/routes/_authenticated.tsx`.

**Consumes:** WS0 (skeleton, `API_VERSION`), WS1 (**IP-2** `sessionStorage`),
WS2 (**IP-3**, **IP-7**, **IP-9**, **IP-10**), WS3 (**IP-6-ctx**).

**Steps**

1. `vite.config.ts`: `tanstackStart({ srcDirectory: 'app' })` **before**
   `viteReact()`, then `nitro({ preset: 'node-server' })`. `server.port` from
   `process.env.PORT || 3000`, `server.allowedHosts: true` (the CLI tunnel).
   `ssr.noExternal: ['shopify-app-tanstack-start']` (JIT source consumption, ADR 0008).
2. `shopify.web.toml`: `roles = ["frontend","backend"]`, `[commands] dev = "pnpm dev"`.
   `.env.example`: `DATABASE_URL`, `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SCOPES`
   (server-only; **no `VITE_` mirror**). `apps/web/package.json` `predev` =
   `routes:generate` + `graphql-codegen` + `db:migrate`. (ADR 0008 §`shopify app dev`)
3. `app/shopify.server.ts`: `createShopifyApp({ apiKey: process.env.SHOPIFY_API_KEY,
   apiSecretKey: process.env.SHOPIFY_API_SECRET, appUrl: process.env.HOST ?? …,
   apiVersion: API_VERSION, sessionStorage, scopes: process.env.SCOPES?.split(',') })`
   and re-export `requestMiddleware`, `adminMiddleware`, `handlers`,
   `unauthenticated`, `addDocumentResponseHeaders`. **This is the IP-2 + IP-3
   nexus.** Import `shopify-app-tanstack-start/adapters/node` for effect at the top.
4. `app/start.ts`: `createStart(() => ({ requestMiddleware: [csrf, requestMiddleware] }))`
   with `createCsrfMiddleware({ filter: (ctx) => ctx.handlerType === 'serverFn' })`
   so Shopify webhook POSTs aren't Origin-checked (ADR 0002 / ENG-2321).
5. `app/router.tsx`: `createRootRouteWithContext<ShopifyRouterContext>()` seed;
   `getRouter()` returns a fresh instance per call; wire `queryClient`.
6. `app/routes/__root.tsx` (**IP-9 head**, **IP-1 error boundary**): the document
   shell. In `<head>`, **before `<HeadContent />`**, three **literal non-async**
   tags in order — `<meta name="shopify-api-key" content={apiKey}>` →
   `<script src="https://cdn.shopify.com/shopifycloud/app-bridge.js">` →
   `<script src="https://cdn.shopify.com/shopifycloud/polaris.js">`. `apiKey` comes
   from a **server-only read** of `process.env.SHOPIFY_API_KEY` passed to `head`
   (no `VITE_`). `suppressHydrationWarning` on **`<html>` and `<head>`** with a
   load-bearing comment. `errorComponent` + `notFoundComponent` render with `<s-*>`
   web components but **guard** `window.shopify` (`if (typeof window !== 'undefined'
   && window.shopify)`) — they must render if App Bridge init is what failed.
   `beforeLoad` copies `{ shop, isAuthenticated }` from `serverContext` into router
   context (the SSR middleware result; ADR 0003/0007). No auth *logic* here.
   (ADR 0006 §head, §`suppressHydrationWarning`, §error boundary)
7. `app/routes/_authenticated.tsx` (**IP-6 gate**): pathless. `beforeLoad` reads
   the dehydrated `{ shop, isAuthenticated }`; `!isAuthenticated` → `throw redirect`
   to `/auth/session-token?shopify-reload=<path>`. Renders `<s-app-nav>` + plain
   `<s-link href>` children + a `document.addEventListener('shopify:navigate', e =>
   navigate({ to: e.target.getAttribute('href') }))` listener + `<Outlet/>`. **No
   `@shopify/polaris` `AppProvider`, no `@shopify/app-bridge-react`.** (ADR 0006 §nav, §structure)

**Integration points produced:** **IP-1** (root error boundary), **IP-6** (the
`_authenticated` gate + chrome), **IP-9** (head).

**Done when:** `pnpm --filter web dev` boots; a direct (non-embedded) load renders
the `<s-page>` shell and the error boundary survives blocking `polaris.js`; the
embedded run is verified in a dev store (see §7).

---

### WS7 — App: routes & codegen  ·  ADR 0007, ADR 0008  ·  wave 4

**Owns:** `apps/web/app/routes/index.tsx`,
`apps/web/app/routes/_authenticated/app/index.tsx`,
`apps/web/app/routes/_authenticated/app/additional.tsx`,
`apps/web/app/routes/auth/$.ts`, `apps/web/app/routes/webhooks/*.ts`,
`apps/web/app/server/*.ts` (server fns), `apps/web/.graphqlrc.ts`,
`apps/web/app/types/admin.generated.d.ts` + `admin.types.d.ts` (committed),
the `graphql-codegen` script in `apps/web/package.json`, and — as a data value —
the **global-middleware path-exclusion list** consumed by WS2's `requestMiddleware`
(**IP-7**).

**Consumes:** WS2 (`handlers.auth`, `adminMiddleware`), WS3 (**IP-5** admin
typing), WS4 (**IP-8** webhooks factory), WS5 (`_authenticated`, `__root`,
`shopify.server.ts` re-exports).

**Steps**

1. `.graphqlrc.ts` + codegen: `@shopify/api-codegen-preset`, `ApiType.Admin` only,
   `apiVersion` imported from `apps/web/app/shopify.config.ts`,
   `documents: ['app/**/*.{ts,tsx}', '!app/types/**']`, output →
   `apps/web/app/types/admin.{generated.d.ts,types.d.ts}`. `graphql-codegen` script;
   commit both files. (ADR 0007 §codegen)
2. `routes/index.tsx` (`/`): `?shop`/`host` present → `redirect({ href:
   `/app${location.searchStr}` })`; otherwise render a minimal `<s-page>` +
   `<s-banner tone="warning">` "This app must be opened from your Shopify admin."
   No form, no other redirect. (ADR 0007 §route tree)
3. `routes/_authenticated/app/index.tsx`: `<s-page>`. `loader` = thin initial read
   (`shop`/`apiKey` from context). A "Generate a product" button → `useMutation` →
   `generateProduct()` server fn (**step 5**). Render result as `<pre>` JSON +
   `<s-link href="shopify://admin/products/{id}">`. `router.invalidate()` on
   success. (ADR 0007 §index page, §data-flow)
4. `routes/_authenticated/app/additional.tsx`: static Polaris web-component content;
   nav-demo target, no Admin calls. (ADR 0007 §route tree)
5. `app/server/generate-product.ts`: `createServerFn({ method: 'POST' })
   .middleware([adminMiddleware])` running `productCreate` then
   `productVariantsBulkUpdate` (verbatim from the RR template) via `context.admin.graphql`.
   The `#graphql` strings here are what codegen (step 1) generates from. (ADR 0007 §Q3)
6. `routes/auth/$.ts`: server route mounting `shopify.handlers.auth`. (ADR 0002/0007)
7. `routes/webhooks/app.uninstalled.ts`, `app.scopes_update.ts`, `compliance.$.ts`:
   server routes wiring `shopify.handlers.webhooks` (**IP-8**). `app/uninstalled`
   deletes the offline session; `app/scopes_update` persists `payload.current` →
   `Session.scope` + `storeSession`; `compliance.$` returns GDPR `200` stubs for
   the three topics. (ADR 0004 §starter routes)
8. **Path-exclusion list** (**IP-7**): the middleware skips `/` exactly, `/auth`,
   `/auth/*`, `/webhooks/*`. Everything else goes through embedded auth. Hand this
   list to WS2's `requestMiddleware` as its exclusion config. (ADR 0007 §exclusion list)
9. Route file-naming: **directory-nested** convention (documented, unenforced —
   TanStack's generator accepts flat + nested). (ADR 0008 §Turbo pipeline)

**Integration point produced:** **IP-7** (the exclusion-list values).

**Done when:** `pnpm turbo run typecheck build` is green from a clean checkout;
the embedded index page runs `generateProduct` end to end against a dev store; the
three webhook routes return `200` for a valid signed payload and `401` for a bad one.

---

## 5. Integration points (the contracts that keep parallel work from colliding)

| # | Contract | Produced by | Consumed by | Source of truth |
|---|---|---|---|---|
| **IP-1** | Root `errorComponent` / `notFoundComponent` — `<s-*>` markup, **guard** `window.shopify`, must render without App Bridge | WS5 | — | ADR 0006 §error boundary |
| **IP-2** | `sessionStorage` — a `DrizzleSessionStoragePostgres` behind the `SessionStorage` interface | WS1 | WS5 (`shopify.server.ts`) | ADR 0005, ADR 0003 |
| **IP-3** | `createShopifyApp(config)` return object `{ api, sessionStorage, requestMiddleware, adminMiddleware, unauthenticated, registerWebhooks, addDocumentResponseHeaders, handlers, config }` | WS2 | WS5, WS7 | ADR 0001 §return value |
| **IP-4** | `adminMiddleware` context `{ admin, session, scopes, billing }` (server-only; `billing` reserved) | WS2 (assembled) + WS3 (`admin` factory) | WS7 server fns | ADR 0003 §1, ADR 0002 §layer 2 |
| **IP-5** | `admin.graphql()` → parsed `{ data, errors, extensions }`; typed `GraphQLClient<AdminOperations>` where `AdminOperations` (from `@shopify/admin-api-client`) is augmented by `apps/web/app/types/admin.generated.d.ts` | WS3 + WS7 (codegen) | WS7 | ADR 0003, ADR 0007 §codegen |
| **IP-6** | The pathless `_authenticated` gate: `beforeLoad` on dehydrated `{ shop, isAuthenticated }` → bounce; renders `<s-app-nav>` + `shopify:navigate` listener + `<Outlet/>`. Its context type `{ shop, isAuthenticated, queryClient }` | WS5 (gate) + WS3 (type) | WS7 (pages sit under it) | ADR 0006 §structure, ADR 0003 §3 |
| **IP-7** | Global `requestMiddleware` + its **path-exclusion list** (`/` exact, `/auth*`, `/webhooks/*`) | WS2 (middleware) + WS7 (list values) | WS5 (`start.ts` registers it) | ADR 0002, ADR 0007 §exclusion list |
| **IP-8** | Webhook handler payload `{ shop, topic, webhookId, apiVersion, payload, session? }` + `200/500/401/400/405` contract | WS4 | WS7 webhook routes | ADR 0004 |
| **IP-9** | `__root` head: literal non-async `<meta shopify-api-key>` → `app-bridge.js` → `polaris.js` before `<HeadContent/>`; `apiKey` from a server-only `process.env.SHOPIFY_API_KEY` read. `addDocumentResponseHeaders` sets per-shop CSP `frame-ancestors` from the middleware | WS5 (head) + WS2 (`addDocumentResponseHeaders`) | — | ADR 0006 §head, ADR 0008 §env |
| **IP-10** | Package `/react`: `React.JSX.IntrinsicElements` shim `.d.ts` (+ `<s-link rel>` patch) + `useShopify()` | WS2 | WS5, WS7 | ADR 0006 §package `/react` |

---

## 6. Cross-cutting rules (apply in every workstream)

1. **`@shopify/polaris` (React) is a forbidden dependency.** Web components only
   (`<s-page>`, `<s-link>`, `<s-app-nav>`, …). Enforced by `no-restricted-imports`
   (WS0). `@shopify/app-bridge-react` is *permitted* but unused by the starter.
   (ADR 0006)
2. **`packages/shopify-app-tanstack-start/src/**` stays runtime-agnostic** — no
   `node:*`, no bare `crypto`/`fs`/`path`/`net`/`tls`/`stream`; Web Crypto via
   `@shopify/shopify-api`'s adapter; Web `Request`/`Response` + `getRequest()`
   only. Lint-enforced. `apps/web` server code follows the same rules **except**
   the two commented swap points: `apps/web/app/db/client.ts` and
   `apps/web/vite.config.ts` / the nitro preset. (ADR 0009)
3. **Env is read per request**, never at module scope — inside middleware /
   handlers / `handler.fetch` context. (ADR 0009 / ENG-2321)
4. **Never put access tokens on a `beforeLoad`/`loader` return, `serverContext`,
   or a client `sendContext`.** Client-safe context is `{ shop, isAuthenticated,
   queryClient }` only. (ADR 0003)
5. **`admin.graphql()` returns parsed `{data,errors,extensions}`**, not a
   `Response` — RR divergence, don't "fix" it. (ADR 0003)
6. **Webhooks are server routes, never `createServerFn`**, and are excluded from
   the CSRF filter. (ADR 0004 / ENG-2321)
7. **One dated `API_VERSION`** (`apps/web/app/shopify.config.ts`) — imported by the
   runtime config and `.graphqlrc.ts`; the `shopify.app.toml` copy carries a
   sync comment. Not `LATEST_API_VERSION`. (ADR 0008)
8. **The prototype is reference-only.** `prototype/appbridge-polaris-tanstack/FINDINGS.md`
   (branch `prototype/appbridge-polaris-ssr`) is the primary source for the shell
   behaviour — read it, build fresh in `apps/web`, **do not merge the prototype**.
   (ADR 0006)

---

## 7. Post-build verification checklist

Not new tickets — things a decision flagged for confirmation during the build:

- [ ] **Prod serve**: `pnpm --filter web build` then `node
      apps/web/.output/server/index.mjs` serves the **built** client, not the dev
      virtual entry. The prototype saw the dev entry referenced — most likely a
      `srcDirectory` (`src` vs `app`) misconfig. (ADR 0008)
- [ ] **Embedded shell**, verified in a real dev store over the `shopify app dev`
      cloudflare tunnel (not `--use-localhost`): `window.shopify` is an object at
      layout mount, `idToken()` resolves, `<s-app-nav>` projects into the admin
      sidebar and highlights the active item, `shopify:navigate` routes without an
      iframe reload, and the fetch interceptor puts `Bearer` on both `fetch()` and
      `createServerFn` RPC. (ADR 0006 / ENG-2335)
- [ ] **`<s-app-nav>` TypeScript**: the `/react` JSX shim makes `<s-app-nav>` /
      `<s-link>` compile under React 19's `React.JSX`. (ADR 0006)
- [ ] **Hydration**: with `suppressHydrationWarning` on `<html>`/`<head>`, the
      embedded app hydrates without wedging (effects run, buttons live). Allow a
      few seconds — embedded hydration is slower than direct. (ADR 0006)
- [ ] **`generateProduct`** creates a product + sets a variant price against the
      dev store and the admin deep link resolves. (ADR 0007)
- [ ] **Webhooks**: `app/uninstalled` deletes the offline session;
      `app/scopes_update` persists the new scope; compliance topics `200`. Bad
      HMAC → `401`. (ADR 0004)
- [ ] **Known limitation, no fix expected**: on multi-instance hosting the
      per-process de-dupe `Map` + `afterAuth` idempotency handler can double-fire
      `afterAuth`. Harmless for the no-op starter handler. (ADR 0009)

---

## 8. Suggested execution order for a single agent

`WS0` → (`WS1`, `WS2`, `WS3`, `WS4` in any order; do `WS2`+`WS3` close together
for the IP-4 handshake) → `WS5` → `WS7` → §7 checklist.
