# Runtime assumptions & deployment portability

This is the **hand-off note for the deferred deployment effort** (deployment /
Terraform / Cloudflare–AWS–GCP choice is out of scope for this map). It records
the runtime the starter targets now, the constraints the plan bakes in to keep
other runtimes open, and exactly what a future deployment effort has to change.

## Runtime target now: Node 22

- `apps/web` builds with `vite build` + `nitro()` pinned to **`preset:
  'node-server'`** (explicit, not the default) → `.output/`, served by
  `node .output/server/index.mjs` (ENG-2332).
- Node **22** (ENG-2332) — `@shopify/shopify-api@14` requires it.
- Nothing is shipped for any other target. No `wrangler.jsonc`, no Dockerfile
  (Dockerfile is separately out of scope on the map), no Lambda handler. This ADR
  describes the swaps; producing the configs is the deployment effort's job.
  Half-wired configs that no pipeline exercises rot.

## The runtime-adapter family

`packages/shopify-app-tanstack-start` mirrors `@shopify/shopify-api`'s adapter
convention (and `@shopify/shopify-app-react-router`'s): a set of side-effect
subpath modules the consumer imports once, each binding the package to one
runtime.

- **Ships now:** `shopify-app-tanstack-start/adapters/node`. This **renames
  ENG-2325's `/node` entry to `/adapters/node`** — a minor revision to that
  ticket's `exports` map, for exact parity with `@shopify/shopify-api/adapters/node`.
- **Adapter contract** — an `/adapters/<runtime>` module:
  1. imports the matching `@shopify/shopify-api/adapters/<runtime>` (which
     registers that runtime's `crypto` / `fetch` / `base64` implementations into
     `@shopify/shopify-api`'s global runtime table);
  2. calls `setAbstractRuntimeString(() => '<Runtime string>')`;
  3. exports nothing. It is imported for effect, at the top of the consumer's
     `src/start.ts`.
- **Named future siblings (documented, not shipped):**
  `shopify-app-tanstack-start/adapters/web-api` (generic Web / Fetch runtimes)
  and `shopify-app-tanstack-start/adapters/cf-worker` (Cloudflare Workers).
  Adding one is a ~10-line file following the contract above plus an `exports`
  entry — the deployment effort adds the one it needs.
- The package's own code already imports `@shopify/shopify-api/adapters/web-api`
  for **Web Crypto** (ENG-2325); the `/adapters/node` module is additive, not a
  replacement of that baseline.

## Portability constraints baked in now

### Enforced — package source

`packages/shopify-app-tanstack-start/src/**` must stay runtime-agnostic:

- **No `node:*` built-ins** and no bare `crypto` / `fs` / `path` / `net` / `tls` /
  `stream` imports. Enforced by an **oxlint `no-restricted-imports` rule** scoped
  to the package's `src/` (added to the ENG-2332 oxlint config).
- Crypto is Web Crypto via `@shopify/shopify-api`'s adapter. Webhook HMAC is
  `api.webhooks.validate` (ENG-2328) — never a hand-rolled `node:crypto` HMAC.
- No filesystem persistence, no module-scope mutable singletons for per-request
  data.
- **Env is read per request** — inside middleware / handlers / `handler.fetch`
  `context`, never at module scope (ENG-2321). Workers inject env per request;
  module-scope `process.env` is empty there.
- Request/response is the Web `Request` / `Response` surface + `getRequest()` /
  cookie helpers from `@tanstack/react-start/server` (ENG-2321). No
  `node:http` `IncomingMessage`.

### By convention — app server code

`apps/web/app/**` server code stays portable by the same rules, **except two
explicitly marked swap points**:

- `app/db/client.ts` — the `pg` + `drizzle-orm/node-postgres` client (ENG-2329).
  `pg` uses `node:net` / `node:tls` and is **not** Workers-compatible. This is
  the **primary non-portable dependency** in the starter.
- `vite.config.ts` / the `nitro()` preset — the build-target seam itself.

Both carry a comment naming them as deployment swap points. They are exempt from
the lint rule; nothing else in `apps/web` server code is.

### Known single-instance limitation

ENG-2326's per-shop **in-flight de-dupe `Map`** and **60-second `afterAuth`
idempotency handler** are per-process. On multi-instance hosting (AWS Lambda,
several Node pods, Cloudflare Worker isolates) two instances can each run
`hooks.afterAuth` once for the same shop inside the TTL window. For the starter's
`afterAuth` (which does nothing by default) this is harmless; an app that puts
non-idempotent work there must know.

**This ticket does not add a seam for it** (ENG-2326 stays untouched). The
deployment effort replaces the `Map` + handler with a shared lock — Cloudflare
Durable Object / KV, Redis `SETNX`, or a Postgres advisory lock — behind the same
call sites.

## What a future deployment effort changes, per target

| Target | Build | Code changes |
|---|---|---|
| **Cloudflare Workers** | Swap `nitro()` for `@cloudflare/vite-plugin`; `wrangler.jsonc` with `main: "@tanstack/react-start/server-entry"` and `compatibility_flags: ["nodejs_compat"]` | Add `adapters/cf-worker`; swap `app/db/client.ts` to a serverless/HTTP Postgres driver (`@neondatabase/serverless`, `postgres` over `connect()`, or Hyperdrive) behind the unchanged `SessionStorage` interface; replace the ENG-2326 in-memory de-dupe with a Durable Object / KV lock; confirm all env reads are request-scoped |
| **AWS Lambda** | `nitro({ preset: 'aws_lambda' })`, optionally `awsLambda: { streaming: true }` if HTML streaming matters | Replace the in-memory de-dupe with a shared lock (cold starts + concurrency make the double-fire window routine here); `pg` works but prefer RDS Proxy / a pooled connection; env from Lambda config |
| **AWS ECS / Fargate (container)** | `nitro({ preset: 'node-server' })` (unchanged), containerize `.output/` on a Node 22 base image | None beyond the shared-lock swap if running >1 task |
| **GCP Cloud Run** | `nitro({ preset: 'node-server' })` (unchanged), containerize `.output/` | None beyond the shared-lock swap if `min-instances`/concurrency allows >1 instance. No Nitro GCP preset exists — Cloud Run just runs the Node listener |

**Dockerfile** for the container targets is out of scope on the map; the
deployment effort writes it.

## What does NOT change on any target

- The WinterCG `fetch(Request) → Response` handler — the deployment seam
  (ENG-2321).
- The route tree, `createShopifyApp(config)` surface, and the three-way context
  model (ENG-2325 / ENG-2327).
- The `@shopify/shopify-app-session-storage` `SessionStorage` interface
  (ENG-2323 / ENG-2329) — only its backing driver.
- The auth control flow: token exchange, the two-layer boundary, the bounce
  (ENG-2326).
- Webhook HMAC validation and the server-route contract (ENG-2328).

## Why

- **Explicit `node-server` preset.** Relying on Nitro's default means the target
  changes silently if Nitro's default does. The starter states its runtime.
- **Adapter family over a single `/node` entry.** The consumer already has to
  import *something* to bind the runtime (`@shopify/shopify-api` requires an
  adapter import). Matching that library's `/adapters/<runtime>` naming makes the
  future swap a one-line import change a reader can guess, and keeps parity with
  the RR package the starter mirrors.
- **Lint-enforce the package, not the app.** The package is the reusable, must-
  stay-portable unit; a CI-visible rule stops `node:crypto` creeping in during a
  refactor. `apps/web` is the fork-and-edit surface — over-linting it fights the
  two legitimate Node dependencies (the pg driver, the build config) instead of
  isolating them.
- **Document the in-memory limitation, don't seam it.** A `Lock` interface with
  one in-memory impl is abstraction the starter can't exercise or test, for a
  problem that only appears under a hosting choice this map explicitly defers.
  ENG-2326's code is simpler left alone; the ADR row above is the whole fix
  spec.
- **No example configs.** Same reasoning the user applied to the Dockerfile: a
  `wrangler.jsonc` that no build runs drifts out of date against
  `@cloudflare/vite-plugin` and misleads. The per-target table is the durable
  artifact.

## Considered and rejected

- **Ship `adapters/web-api` + `adapters/cf-worker` now.** Rejected: untested edge
  adapters that no build path exercises. The contract is documented; adding one
  is trivial when a deployment effort needs it.
- **Pluggable `Lock` / `IdempotencyStore` interface in the package now.**
  Rejected — see Why. Revisit in the deployment effort.
- **Lint-enforce portability across `apps/web` too.** Rejected: the two real Node
  dependencies would need per-line exemptions; isolating them to two commented
  files is clearer than a broad rule with holes.
- **Ship a Node-container Dockerfile.** Out of scope on the map; also it only
  serves the container targets, not the edge ones.
- **A standalone `docs/deployment.md` instead of an ADR.** Rejected: this is a
  decision with rejected alternatives and a rationale, so it belongs with the
  other ADRs; the README stub points here.

## Consequences

- **ENG-2325** is revised: its `/node` export becomes `/adapters/node`, and the
  `exports` map gains documented (unshipped) `/adapters/web-api` and
  `/adapters/cf-worker` slots.
- **ENG-2332**'s oxlint config gains a `no-restricted-imports` rule for `node:*`
  and bare Node built-ins scoped to `packages/*/src/**`.
- **ENG-2334** — the build plan's "Deploying" section is this ADR plus the README
  stub; the plan itself stays Node-only.
- `apps/web` carries exactly two files commented as deployment swap points
  (`app/db/client.ts`, `vite.config.ts`); a reviewer can find the whole
  portability surface from those two comments plus this ADR.
- The starter runs on one instance. Multi-instance hosting needs the shared-lock
  swap before `afterAuth` side effects are safe.
