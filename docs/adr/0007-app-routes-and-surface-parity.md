# App routes & surface parity

`apps/web`'s concrete route tree, mirroring the React Router template's surface,
on the ENG-2330 shell skeleton. Also the GraphQL codegen setup. One prior
decision is revised: ENG-2326's `/auth/login` shop-domain form.

## Route tree — by path and responsibility

The TanStack file-naming convention (flat-dotted `app.additional.tsx` vs
directory-nested `app/additional.tsx`) is a **per-app, reversible config choice**
and is **not decided here** — ENG-2332 picks one when it wires the router plugin.
Nothing downstream may depend on the file layout; routes are identified by path.

| Path | Kind | Responsibility |
|---|---|---|
| `__root` | layout | ENG-2330 document shell (head tags, `<s-*>` error/404, CSP from the middleware). `beforeLoad` copies `{ shop, isAuthenticated }` from the SSR `serverContext` (the ENG-2326 request-middleware result) into router context, where it dehydrates for the client. |
| `/` | page | Non-embedded fallback. `?shop` / `host` present → `redirect({ href: `/app${search}` })` (ENG-2330, query-string preserved). Otherwise renders a minimal `<s-page>` with `<s-banner tone="warning">` — "This app must be opened from your Shopify admin." No login form, no redirect. |
| `/app` — pathless `_authenticated` layout | layout | The **only** UX auth gate. `beforeLoad` (server on SSR, client on nav) reads the dehydrated `{ shop, isAuthenticated }`; `!isAuthenticated` → `throw redirect` to the `/auth/$` bounce (ENG-2326). Renders `<s-app-nav>` (two items) + the `shopify:navigate` → `navigate()` listener + `<Outlet />` (ENG-2330). |
| `/app` index | page | `<s-page>`. `loader` does a thin initial read (`shop` / `apiKey` from context). A "Generate a product" button → `useMutation` → `generateProduct()` server fn: `productCreate` then `productVariantsBulkUpdate`, **verbatim from the RR template**. Result rendered as `<pre>` JSON + an `<s-link href="shopify://admin/products/{id}">`. On success `router.invalidate()`; may additionally hydrate into a React-Query hook and refetch to avoid a full transition. |
| `/app/additional` | page | Static Polaris web-component content. Exists to demo `<s-app-nav>` active-state + client-side `shopify:navigate` routing. No Admin calls. |
| `/auth/$` | server route | Bounce / `session-token` / `exit-iframe` — renders the App Bridge `shopify-reload` HTML (ENG-2326). |
| `/webhooks/app.uninstalled` | server route | Delete the offline session for the shop (ENG-2328). |
| `/webhooks/app.scopes_update` | server route | Persist `payload.current` → `Session.scope` (ENG-2328). |
| `/webhooks/compliance.$` | server route | GDPR `customers/data_request`, `customers/redact`, `shop/redact` — `200` stubs (ENG-2328). |

Dropped from RR parity: **`/auth/login`** (the shop-domain form). See below.

## Global request-middleware path-exclusion list

The eager session-load / token-exchange middleware (ENG-2326) **skips** requests
whose path is:

- `/` exactly (the banner fallback needs no session)
- `/auth` or `/auth/*`
- `/webhooks/*`

Everything else flows through embedded auth. This list is load-bearing: a new
public route that is not added here is forced through the boundary and cannot
serve an unauthenticated request.

## Data-flow pattern (the starter's canonical shape)

- Route **`loader`** does initial reads — SSR-friendly, matches the RR mental
  model.
- **Writes** are `POST` server functions invoked via `useMutation`, followed by
  `router.invalidate()`. Reads may additionally be hydrated into a React-Query
  hook and refetched client-side so there is no full-page transition.
- There is no RR-style route `action` — TanStack Start has none.
- All Admin API access is a server function carrying `adminMiddleware` (ENG-2327).
  Access tokens never reach a `loader`/`beforeLoad` return, `serverContext`, or
  the client.

## Non-embedded entry — revises ENG-2326

ENG-2326 shipped `/auth/login` as a shop-domain form redirecting to the
managed-install URL — RR's model, aimed at custom / standalone apps opened
outside Shopify. This starter is **embedded-only** (token exchange + managed
install; `AppStore` / `SingleMerchant` distribution). Revised:

- Non-embedded document request **with** a resolvable `shop` → redirect to
  `api.auth.getEmbeddedAppUrl` — **unchanged** from ENG-2326.
- Non-embedded **without** a resolvable `shop` (bare app URL typed directly) →
  the `/` **banner** page. No form, no shop-domain entry field.
- The package (`shopify-app-tanstack-start`, ENG-2325) may still expose a `login`
  handler as an unused escape hatch; the starter app does not route to it.

A pointer comment is posted on ENG-2326.

## GraphQL codegen

- `@shopify/api-codegen-preset` + `.graphqlrc.ts`, both at `apps/web/`.
- `ApiType.Admin` **only** — nothing in the starter uses Storefront GraphQL.
- `apiVersion` sourced from the single shared constant the package config uses
  (one pin across package + app; ENG-2325 / ENG-2333).
- `documents: ['app/**/*.{ts,tsx}', '!app/types/**']`; `schema` from the preset
  for that `apiVersion`.
- Emits **two** files to `apps/web/app/types/`:
  - `admin.types.d.ts` — schema types for the pinned `apiVersion`; app-independent.
  - `admin.generated.d.ts` — operation types built from *this app's* `#graphql`
    strings (here: the two product mutations). Module-augments
    `@shopify/admin-api-client`'s `AdminOperations`, which is how the package's
    `GraphQLClient<AdminOperations>` typing (ENG-2327) resolves.
- **Nothing in `packages/`.** Same "no second consumer" logic ENG-2329 applied to
  its rejected `packages/db`. The `.graphqlrc.ts` is structured so
  `admin.types.d.ts` is a one-line move into a shared package **if** a second app
  ever lands; `admin.generated.d.ts` is irreducibly per-app and never moves.
- Generated files are **committed** — a fresh `pnpm i && pnpm typecheck` works
  with no Shopify schema fetch (RR parity).
- `apps/web` `package.json` gets a `graphql-codegen` script; ENG-2332 wires the
  Turbo `graphql-codegen` task (feeds `typecheck` / `build`) and a `predev`
  regeneration hook. A codegen-drift CI check is out of scope (deferred effort).

## Why

- **`/` banner over `/auth/login` form.** The shop-domain form only does
  meaningful work for standalone / custom apps, which this starter explicitly is
  not. A managed-install embedded app reached without a shop context has nothing
  useful to ask — the honest response is "open me from Shopify". Keeping the RR
  form would ship a code path the starter's own auth model never exercises.
- **Product-create demo kept verbatim.** It is the recognisable RR parity example
  and exercises variables, a chained second mutation, and error surfacing through
  the typed client in one flow — cheaper to keep and let the dev delete than to
  design a smaller anchor.
- **Generated types in `apps/web`, not a package.** The operation types are a map
  of *this app's* exact query strings; a shared package holding them has no second
  consumer today (the glue package augments an interface, it does not import the
  file). ENG-2329 already set this precedent. Schema types are extractable later
  without touching call sites.
- **File convention deferred.** Flat vs nested is a router-plugin option a dev
  flips in an afternoon; pinning it here would invite downstream code that assumes
  a filename shape.
- **Exclusion list owned here, not in the package.** The package cannot know which
  app routes are public; the list lives with the route tree it describes.

## Considered and rejected

- **RR's `/auth/login` shop-domain form.** Rejected — see Why. Demoted to a
  package escape hatch.
- **Marketing `_index` page (RR).** Rejected: a starter's landing page is the
  first thing a dev deletes; the banner is the minimum honest fallback.
- **Dropping the Admin GraphQL demo entirely.** Considered (avoids "boilerplate
  bloat"); rejected because "decide the codegen setup" needs at least one real
  operation to generate from and to prove the typed-client path end to end.
- **Shared `packages/*` for generated types, both files.** Rejected: operation
  types are per-app; a second app either collides on the file or needs its own
  anyway. If a package is wanted, only `admin.types.d.ts` belongs in it.
- **No route `loader`s, everything via `useQuery`.** Rejected: loses SSR for
  initial reads and departs further from the RR template the starter mirrors.

## Consequences

- **ENG-2332** wires: the TanStack Router plugin + `routeTree.gen.ts` generation
  (gitignored build artifact), the `graphql-codegen` Turbo task + `predev` hook,
  and picks the route file-naming convention.
- **ENG-2334** — the app-surface workstream input is now complete.
- **ENG-2326** is revised: `/auth/login` form → `/` banner; the package `login`
  handler is retained only as an unused escape hatch.
- The `shopify://admin/...` deep-link scheme in the demo assumes App Bridge is
  present to resolve it; on the (rare) non-embedded render of `/app` the link is
  inert, which is acceptable for a demo.
