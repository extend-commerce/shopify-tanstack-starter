# Package public API: `authenticate.*` parity facade, package-owned middleware & guards, shipped types

**Supersedes [ADR 0001](0001-tanstack-idiomatic-package-surface.md) in part** (the "middleware and
handler factories, *not* a port of RR's `authenticate.*`" decision). Amends
[ADR 0002](0002-auth-boundary-and-bounce-control-flow.md) (bounce ownership),
[ADR 0003](0003-three-way-context-model.md) (`admin.graphql` return shape),
[ADR 0004](0004-webhook-handling.md) (webhook entry points),
[ADR 0006](0006-app-shell.md) (`/react` + a new `/middleware` entry).

Decision ticket: ENG-2360. Research: ENG-2359. Contract tests: ENG-2360 done-when;
broader package suite: ENG-2361.

## Context

The package (`shopify-app-tanstack-start`) was built to ADR 0001: its public surface
is `requestMiddleware` / `adminMiddleware` / `handlers.{auth,webhooks}` factories,
deliberately **not** a port of `@shopify/shopify-app-react-router`'s
`authenticate.admin(request)` / `authenticate.webhook(request)` call shape. A
post-build review (merged starter vs `@yan-ad/shopify-app-tanstack`) found:

- Hand-rolled glue that should not be the template author's problem —
  `apps/web/app/shopify.middleware.ts` is a `createMiddleware().server()` husk with
  `as never` double-casts and inline dynamic imports, working around the fact that
  `~/shopify.server` (which pulls `pg` + the Node adapter) must not enter the client
  bundle.
- Auth control flow leaking into app code: the `_authenticated.tsx` bounce with
  `id_token` stripping, and a three-branch `beforeLoad` in `__root.tsx`.
- Consumer code needs `as` casts — the package ships no ambient types for
  `window.shopify` or the TanStack Start server context.
- An RR-template author has to learn a new call site with no migration aid.

**Research (ENG-2359):** `@yan-ad/shopify-app-tanstack` is a hard fork of RR v1.2.0
(~80 of 115 `src/` files byte-identical) that ports the `authenticate.*` names and
return shapes verbatim — confirming they are what consumers expect — but it never
solved TanStack Start's isomorphic-loader / dehydration / client-bundle constraints
(it targets TanStack *Router*, where the app supplies its own server; its
`authenticate.admin` hands back a live client plus non-serialisable
`redirect`/`cors`/`billing` functions, and its error `boundary` keys on React Router
runtime type names). Adopting that model wholesale is not viable; a parity **facade**
over the existing engine is.

**Empirical check:** the husk is still required at `@tanstack/react-start@1.168.49`.
Replacing `shopify.middleware.ts` with a plain top-level re-export of
`requestMiddleware` / `adminMiddleware` from `~/shopify.server` fails the `apps/web`
build with `[plugin tanstack-start-core:import-protection] Import denied in client
environment`, thrown in `generateBundle` — i.e. the server import survives
tree-shaking into the client graph (matches TanStack issues #2783 / #6185).

## Decision

### 1. Add an `authenticate.*` parity facade

`createShopifyApp(config)` gains `authenticate`, mirroring
`@shopify/shopify-app-react-router` **v2** names and return shapes (not the yan-ad
v1.2.0 fork). Each method takes an **explicit `Request`** and is called inside a
server function or a server route — never an isomorphic `beforeLoad` / `loader`.

| Method | Returns |
|---|---|
| `authenticate.admin(request)` | `{ admin, session, scopes, billing }` |
| `authenticate.webhook(request)` | `{ shop, topic, webhookId, apiVersion, payload, session? }` — throws the RR-exact failure `Response` on bad HMAC / method / missing headers |
| `authenticate.flow(request)` | RR v2 shape |
| `authenticate.pos(request)` | RR v2 shape |
| `authenticate.fulfillmentService(request)` | RR v2 shape |
| `authenticate.public.appProxy(request)` | `{ session?, admin?, storefront?, liquid }` |
| `authenticate.public.checkout(request, { corsHeaders? })` | `{ sessionToken, cors }` |
| `authenticate.public.customerAccount(request, { corsHeaders? })` | `{ sessionToken, cors }` — helper only, no Customer Account GraphQL client (unchanged from ADR 0003) |

`authenticate.<surface>` is the **single implementation**. `adminMiddleware` (and any
future middleware) becomes a thin adapter that calls it and spreads the result into
`next({ context })` — no parallel code paths.

The **middleware idiom stays the starter template's primary style**; `authenticate.*`
is documented as an equal alternative for RR-migration ergonomics and for server
routes (which cannot carry function middleware).

The map's standing preference *"TanStack-idiomatic over API-mimicry"* is **softened**:
mimicry is now an explicit, equal-status second surface where it lowers migration
cost and does not fight the framework.

### 2. `admin.graphql` returns a Fetch `Response` (reverses ADR 0003)

ADR 0003 had `admin.graphql()` resolve the parsed `{ data, errors, extensions }`.
**Reversed** to RR-exact: `admin.graphql(query, options)` resolves a **Fetch
`Response`**, typed against `AdminOperations` so `(await res.json()).data` stays
typed. Built from `api.clients.Graphql` (RR's client), not
`@shopify/admin-api-client`.

Rationale: judged as a public API, the parsed shape hid response status, rate-limit /
cost headers (`extensions.cost`, `Retry-After`), and deprecation warnings. RR parity
also removes a migration gotcha.

Consequence: a server function calling the Admin API unwraps explicitly —
`const res = await admin.graphql(...); const { data } = await res.json();`. The
`Response` never crosses to the client (a server function's own return value is what
serialises).

### 3. Package owns the client-safe middleware husk

New client-safe entry `shopify-app-tanstack-start/middleware` exports
`defineShopifyMiddleware`:

```ts
// apps/web/app/shopify.middleware.ts — the whole file
import { defineShopifyMiddleware } from 'shopify-app-tanstack-start/middleware';

export const { requestMiddleware, adminMiddleware } =
  defineShopifyMiddleware(() => import('~/shopify.server'));
```

`defineShopifyMiddleware` builds the `createMiddleware().server()` shells, performs
the dynamic import + delegation internally, and is generically typed against the
package's own `ShopifyApp` type — so the returned middleware carry
`{ shopify: ShopifyRequestContext }` / `AdminMiddlewareContext` with **zero `as`
casts in the app or the package**. The `/middleware` entry is client-safe by
construction (must not transitively import server-only code).

Implementation note: confirm at build time that passing `() => import('~/shopify.server')`
as an **argument** (rather than a literal `import()` inside `.server()`, which is a
known-safe spot) does not itself leak — the thunk must land in a tree-shaken region.

### 4. Package owns the bounce guard and context hydration (amends ADR 0002)

Two new exports from the main entry:

- **`authGuard`** — a `beforeLoad` handler for the pathless `_authenticated` layout.
  Owns the unauthenticated bounce: the `id_token` strip, the `throw redirect()` to
  `${authPathPrefix}/session-token?shopify-reload=…`, and the "App Bridge already
  initialised → do not bounce mid-session" short-circuit. The app spreads it in and
  keeps only the choice of which route to gate.
- **`hydrateRouterContext`** — the `__root` `beforeLoad` job of copying
  `{ shop, isAuthenticated }` out of the SSR `serverContext` into router context.

App code no longer contains auth control flow.

### 5. Shipped ambient types

The package ships ambient declarations so consumer code needs **zero
`as` / `never` / `unknown` casts**:

- `window.shopify` (the App Bridge global) — augmented from the `/react` entry.
- The TanStack Start server context (`serverContext.shopify`) — augmented from the
  main (`.`) entry.

Both via `declare global` / `declare module` in files pulled in transitively by any
import from those entries (same mechanism as the existing `shopify-elements.d.ts`).
No `/// <reference>` in consumer code. `@yan-ad/shopify-app-tanstack` ships nothing
here; RR v2's approach is the reference. Exact file wiring is an implementation
detail, not part of this decision.

### 6. Webhooks: primitive + sugar (amends ADR 0004)

`authenticate.webhook(request)` is the primitive. ADR 0004's polymorphic
`handlers.webhooks(handlerOrMap)` factory stays, **reimplemented on top of the
primitive**. Both are shipped and documented — the factory for the common "one route
file, dispatch by topic" case, the primitive for hand-rolled response control.

### 7. App surface (`apps/web`)

Unchanged except: add **one `app-proxy` example route** plus `AppProxyProvider` /
`AppProxyLink` usage on a React page. `flow` / `pos` / `fulfillmentService` get a
documented code snippet each — no example route (they need real extension configs to
exercise; verified later via a dedicated test app).

### 8. Package `exports` map

Adds `/middleware` (client-safe). `.` / `/react` / `/webhooks` / `/clients`
unchanged — **no** `/adapters/*` exports. Runtime polyfills are imported from
`@shopify/shopify-api/adapters/<runtime>` in the app platform seam (amends ADR
0009). Package stays unpublished / JIT TypeScript source (ADR 0008 unchanged);
`dist/` + release automation remain out of scope.

## Considered and rejected

- **Adopt the `@yan-ad/shopify-app-tanstack` model wholesale.** Rejected: a fork of
  RR v1.2.0 that never addressed Start's isomorphic loaders, dehydration, or
  client-bundle splitting; its `authenticate.admin` hands back a live client plus
  non-serialisable functions, and its error `boundary` keys on React Router runtime
  types. Porting it would import the problems ADR 0003 exists to solve.
- **Keep ADR 0001's factory-only surface.** Rejected: the hand-rolled husk, the
  leaked auth control flow, and the missing types are real ergonomic costs, and an
  RR-template author gets no migration aid.
- **Drop the middleware idiom, `authenticate.*` only.** Rejected: the global
  `requestMiddleware` choke point (ADR 0002) and `.middleware([...])` injection are
  useful and framework-idiomatic; the facade is additive.
- **Keep `admin.graphql` parsed (ADR 0003).** Rejected here in favour of full
  `Response` access for a public API; the ergonomic cost is one `.json()` line per
  server-fn call site, and the `Response` never reaches the client anyway.
- **Full husk removal (plain top-level import).** Rejected: empirically fails the
  build at `@tanstack/react-start@1.168.49` (import-protection, post-tree-shake).

## Consequences

- ADR 0001's "not an `authenticate.*` port" is superseded; ADR 0003's `admin.graphql`
  parsed return is reversed; ADR 0002's bounce / hydration move into the package;
  ADR 0004 gains the `authenticate.webhook` primitive; ADR 0006's `/react` gains the
  `window.shopify` augmentation and the package gains a `/middleware` entry.
- Every `apps/web` Admin call site changes to
  `const { data } = await (await admin.graphql(...)).json()`.
- `apps/web/app/shopify.middleware.ts` shrinks to two lines; `_authenticated.tsx` /
  `__root.tsx` lose their auth branches.
- Contract tests for the new surface are a done-when of ENG-2360; the broader package
  unit suite is ENG-2361.
- The "drop the global two-layer `requestMiddleware` boundary" question stays open and
  unfiled — parked pending experience with the facade.
- `@shopify/admin-api-client` remains a dependency for `AdminOperations` typing even
  though `api.clients.Graphql` replaces it at runtime.
- `authenticate.public.customerAccount` remains the session-token / CORS helper only —
  no Customer Account GraphQL client (ADR 0003 out-of-scope item unchanged).

## Implementation notes

Recorded during the package-side build (ENG-2360). These are execution details,
not new decisions.

### 5 — the TanStack Start server-context augmentation was **not** done; `hydrateRouterContext` is the typed accessor

ADR 0010 5 hoped to `declare module`-augment TanStack Start's server context so
`serverContext.shopify` types itself in a `beforeLoad`. At the pinned versions
(`@tanstack/react-start@1.168.49`, `@tanstack/react-router@1.170.32` →
`@tanstack/router-core@1.171.27`) there is **no clean augmentation target**:
`serverContext` is not a member of `BeforeLoadContextOptions` (nor of
`LoaderFnContext`) — the app reaches it today only via a positional cast
(`serverContext as { shopify?: ShopifyRequestContext }`). `router-core` exposes no
`Register['server']['beforeLoadContext']`-style hook to extend, and the
`Register['server']['requestContext']` slot that *does* exist types the argument to
`handler.fetch(request, { context })`, not the `beforeLoad` `serverContext` arg.

Per the ADR's stated fallback, **`hydrateRouterContext` (exported from `.`) is the
typed accessor**: it performs the single `serverContext as …` cast internally, and
consumer code calls it with zero casts. `ShopifyRequestContext` stays exported from
`.` for the rare direct reader. If a later TanStack release adds a
`declare module`-able server-context interface, the augmentation can be added as a
`.d.ts` pulled in from `.` (same mechanism as `/react`'s `window.shopify`) without
changing `hydrateRouterContext`'s signature.

### 3 — `defineShopifyMiddleware` delegates the request husk via `.options.server`, the admin husk via `authenticate.admin`

`RequestMiddleware.options.server` preserves its `TServerContext` type param, so the
`requestMiddleware` husk delegates straight through
(`mod.requestMiddleware.options.server(options)`) and keeps `{ shopify:
ShopifyRequestContext }` with no cast. `FunctionMiddleware.options.server` erases
`TNewServerContext` to `unknown`, so delegating the `adminMiddleware` husk that way
would drop `AdminMiddlewareContext` (this is the `as never` the old hand-written
husk needed). Instead the admin husk calls `authenticate.admin(getRequest())`
directly — `authenticate.admin` **is** the single implementation `adminMiddleware`
adapts (§1), so `next({ context })` infers `AdminMiddlewareContext` with zero casts.
Consequently `loadServerModule` must resolve `{ requestMiddleware, authenticate }`
(both are on the `createShopifyApp` return); `() => import('~/shopify.server')`
satisfies it once the app re-exports `authenticate`.

**App-phase resolution of the thunk-as-argument leak check (ENG-2360 Phase 2).**
A bare `defineShopifyMiddleware(() => import('~/shopify.server'))` **fails** the
`pnpm --filter web build` — the arrow is a module-scope argument to a plain
function call, which the Start compiler does not strip, so import-protection
traces `start.ts → shopify.middleware.ts → import('~/shopify.server')` and denies
the client build (`generateBundle`, matches the empirical check above). Fix: the
app wraps the loader in `createIsomorphicFn().server(() => import('~/shopify.server'))`
— the `.server()` body (and its dynamic import) is stripped from the client
bundle by the same transform that strips `createMiddleware().server()` bodies, so
`shopify.middleware.ts` is `import('~/shopify.server')`-free in the client graph.
`defineShopifyMiddleware` is unchanged; `apps/web/app/shopify.middleware.ts` is
~6 lines instead of the 2 above (still no `createMiddleware` husk, no `as never`,
no delegation logic in app code). Client-bundle assertion added to the contract
tests (greps `.output/public/assets/**` for `pg` / `node:async_hooks` /
`SHOPIFY_API_SECRET` / `drizzle-orm` / `createShopifyApp` — none present).

### 4 — `authGuard` / `hydrateRouterContext` in isomorphic `beforeLoad`: no client leak (§D check)

ADR 0010 D asked whether importing `authGuard` / `hydrateRouterContext` from the
package's `.` (server) entry into an isomorphic `beforeLoad` drags a server-only
graph into the client. It does **not**: `pnpm --filter web build` passes, and the
client bundle contains only `guards.ts` + `bounce.ts` (both client-safe — the
bounce string `/auth/session-token` legitimately ships client-side because the
guard runs on client navigation). No dedicated client-safe `/guards` subpath was
needed; `.` stays the single import site.

### 2 — `admin.graphql` `.json()` payload is `ClientResponse`, not `FetchResponseBody` (deviation #2)

RR's `GraphQLResponse` types `.json()` as `FetchResponseBody<ReturnData<…>>`
(`{ data?, extensions?, headers? }` — no `errors`). The starter's
`generate-product.ts` demo checks transport-level `errors` (RR's own template
does not). So the package types `.json()` as `ClientResponse<ReturnData<…>>` — a
strict superset of `FetchResponseBody` that also types the optional `errors` —
letting a server fn unwrap `const { data, errors } = await res.json()` with
**zero casts** (the handoff's mandated pattern). `.data` typing is unchanged.
`FetchResponseBody` structurally satisfies `ClientResponse`, so widening
`client.fetch`'s return to `GraphQLResponse` is the single internal cast
`createAdminApiContext` makes.

### 2 — `admin.graphql` is a true `createAdminApiClient().fetch` passthrough (deviation #3, **resolved**)

The Phase 1 build resolved the `Response` by calling `api.clients.Graphql`'s
`.request(...)` (which parses the body) and re-wrapping it in
`new Response(JSON.stringify(parsed))`. `.status` and `extensions.cost` survived
that, but the **real upstream headers did not** — `Retry-After`, rate-limit, and
`X-Shopify-API-Deprecated-Reason` (the headers §2's rationale named) were gone.

`createAdminApiContext(session, apiVersion)` now builds
`createAdminApiClient({ accessToken, storeDomain, apiVersion })` and returns
`client.fetch(operation, { variables, apiVersion, headers, retries, signal })`
**directly** — the same `@shopify/admin-api-client` call
`@shopify/shopify-app-react-router` v2's `admin.graphql` uses. The result is a
genuine `fetch` `Response`: real headers, real status, `.json()` typed by the
library. `.fetch()` does not throw on an HTTP error status, so an upstream `401`
comes back as a resolved `Response` — the `authenticateAdmin` 401-retry wrapper
still keys on `res.status === 401` (its old `HttpResponseError` branch is gone,
not just dead). `@shopify/admin-api-client` calls the global `fetch`, so the
package stays runtime-agnostic. The `api: Shopify` parameter Phase 1 added to
`createAdminApiContext` is dropped; the signature is back to `(session,
apiVersion)`. Deviation #2 (`.json()` typed `ClientResponse` for `errors`) is
unchanged.
