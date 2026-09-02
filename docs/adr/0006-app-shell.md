# App shell: `__root` document + pathless `_authenticated` layout

`apps/web` is an embedded Shopify admin app built on the **CDN App Home** stack
(App Bridge + Polaris web components from `cdn.shopify.com`), not `@shopify/polaris`
React and not a Shopify-CLI scaffold. The shell is two layers: a `__root.tsx`
document shell that owns the head stack, CSP, and the root error boundary, and a
pathless `_authenticated.tsx` layout that is the embedded-auth UX gate and renders
the admin chrome. Everything here is derived from the ENG-2335 prototype
(`prototype/appbridge-polaris-ssr`, verified embedded in a real dev store).

## Route structure

```
apps/web/app/routes/
  __root.tsx        document shell; head stack; CSP is set upstream (see below); root error + 404. No auth logic.
  index.tsx         "/"  -> redirect({ href: `/app${search}` })  — query string preserved
  _authenticated.tsx   pathless. beforeLoad gates on dehydrated { shop, isAuthenticated };
                       renders the shopify:navigate listener, <s-app-nav>, <Outlet/>
  _authenticated/app/…  the embedded pages (ENG-2331 owns these files)
  auth/*            bounce / login routes (ENG-2331 places them; excluded from the gate)
```

- Embedded app mounts under **`/app/*`**, mirroring the React Router template.
  `/` is a query-string-preserving redirect to `/app` — App Bridge reads
  `host` / `shop` from the document's query params, so a bare
  `redirect({ to: '/app' })` (which drops the query) breaks App Bridge init
  (prototype finding 1).
- The auth gate is the **pathless `_authenticated` layout**, not per-route checks.
  Its `beforeLoad` (server during SSR, client on nav) reads the client-safe
  `{ shop, isAuthenticated }` from dehydrated router context (populated by the
  global `requestMiddleware` — ADR 0002 / ENG-2327). `isAuthenticated: false` →
  `throw redirect()` to the `/auth/session-token?shopify-reload=<path>` bounce.
  The global middleware never throws for missing auth; the layout is the only
  UX gate.

## Head stack — hand-written in `__root`, not abstracted

`__root.tsx` renders these three tags as **literal JSX**, non-async, in this order,
**before** `<HeadContent />`:

```html
<meta name="shopify-api-key" content={apiKey} />
<script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>
<script src="https://cdn.shopify.com/shopifycloud/polaris.js"></script>
```

- **Not** `head({ scripts: [...] })` / TanStack's script API: `<HeadContent />`
  orders those scripts ahead of a late `<meta>`, and `async` removes the
  before-hydration guarantee — the prototype proved this silently kills App Bridge
  init (no `window.shopify`, no `Bearer` on requests, blank nav).
- `app-bridge.js` **before** `polaris.js` — App Bridge's runtime check logs
  *"should be the first script tag"* otherwise. (The staff-forum "Polaris first"
  tip is contradicted by App Bridge's own current check.)
- React 19 hoists `<meta>` / `<title>` / `<link>` and leaves plain `<script src>`
  after them; the three tags do not stay first children and that is fine —
  Shopify reads the meta whenever App Bridge executes.
- The package **documents** this ordering (README + this ADR); it ships no
  `shopifyHeadTags()` helper. Three literal lines in a file the template owner is
  meant to read beat a hidden abstraction.

## `suppressHydrationWarning` on `<html>` and `<head>`

TanStack Start does `hydrateRoot(document, …)`. `app-bridge.js` and `polaris.js`
run from `<head>` **before** React hydrates and mutate both `<head>` and `<body>`
(`polaris.js` upgrades `<s-page>` and relocates its slotted children, setting
`style="display:none"` on the originals). Without `suppressHydrationWarning` on
`<html>` **and** `<head>`, React 19's mismatch is "won't be patched up" and
**cascades — effects in the whole subtree never run** (prototype finding 5: dead
buttons, frozen panels). With it, hydration completes and effects run.

This attribute is load-bearing and carries a comment saying so. It is **not** a
substitute for thought about slot content (below), but it is what makes raw
`<s-page>` usage safe.

## Polaris web components — raw, no wrapper

App authors use `<s-page>` / `<s-section>` / `<s-link>` / `<s-button>` **directly**.
The starter ships **no `<Page>` wrapper component**: a template should give the
dev control over page structure, not a house abstraction over every primitive.

Guidance (this ADR + a comment in the first example page), not enforced:

- Prefer populating `<s-page>`'s `primary-action` / `breadcrumbs` slots
  declaratively or from a post-hydration `useEffect`, rather than as
  React-state-driven JSX children. `suppressHydrationWarning` on `<html>` keeps
  a slotted `<s-button onClick={…}>` from wedging hydration, but the slot is still
  where `polaris.js` does its most aggressive pre-hydration DOM relocation.
- `<s-button slot="primary-action">` requires `variant="primary"` or `polaris.js`
  errors.

## Navigation — `<s-app-nav>` web component

The `_authenticated` layout renders `<s-app-nav>` with plain `<s-link href>`
children (pure `polaris.js` web components) and a `shopify:navigate` listener:

```ts
document.addEventListener('shopify:navigate', (e) => {
  const href = (e.target as Element).getAttribute('href');
  if (href) navigate({ to: href });
});
```

- `<s-app-nav>` **does** project into the admin sidebar embedded (prototype
  finding 3, corrected: the earlier "did not render" was a TypeScript error, not
  a runtime failure).
- `<s-link>` clicks emit `shopify:navigate`; the listener routes them through
  TanStack with no iframe reload. Keep the listener — it is the ported RR
  `AppProvider` behaviour. Do **not** put `@tanstack/react-router` `<Link>` inside
  the nav (its `aria-current` triggers an App Bridge warning).
- App Bridge is reached via the global `window.shopify`, typed by
  `@shopify/app-bridge-types`. `@shopify/app-bridge-react` is **permitted** (the
  RR template uses it for `<NavMenu>` / `useAppBridge`) but the starter shell does
  not depend on it.

## Package `/react` entry

The package (ENG-2325) `/react` export carries exactly two shell-universal items:

1. **A JSX shim** — a `.d.ts` that re-declares the `<s-*>` custom elements onto
   `React.JSX.IntrinsicElements`. `@shopify/app-bridge-types@0.7.2` and
   `@shopify/polaris-types` augment the **legacy global `JSX` namespace**, which
   React 19's `React.JSX` does not read, so `<s-app-nav>` / `<s-link>` are
   otherwise untyped. The shim also patches the missing `rel` attribute on
   `<s-link>`. Shipped from the package because the package is what makes a
   consumer render `<s-*>` elements. Added to ENG-2325's `exports` map.
2. **`useShopify()`** — a 5-line SSR-safe accessor returning the typed
   `window.shopify` (`undefined` during SSR / before App Bridge init). Saves every
   call site re-writing the `typeof window` guard.

No `<Page>`, no `<ShopifyAppHead>`, no provider component.

## CSP `frame-ancestors`

Per-shop `Content-Security-Policy: frame-ancestors https://{shop}
https://admin.shopify.com;` is emitted on document responses from the **existing
global `requestMiddleware`** (ADR 0002) — it already decodes `shop`, runs for
every document request, and this mirrors RR's `addDocumentResponseHeaders`. Not in
`__root` `headers()`, not a Nitro route rule. No `<link rel="preload">` for the
CDN scripts — they are already non-async in `<head>`; a preload adds a fetch race
for no gain.

## Root error boundary

`__root` defines `errorComponent` and `notFoundComponent`. Both render with
`<s-*>` web components (`<s-page>` / `<s-section>`), consistent with the rest of
the app — `polaris.js` is a plain `<head>` script, independent of `app-bridge.js`,
that executes before any route render, so the page chrome is always available.

**App Bridge access is guarded, not forbidden.** The common cases these boundaries
catch — a `loader` / `beforeLoad` throw, a component render error, a server `500`
surfaced to the client — happen in a fully authenticated embedded session with
`window.shopify` present and usable (`shopify.toast`, `shopify.config.shop`, …).
`window.shopify` is absent or a stub only when the failure being displayed *is*
App Bridge init (CDN blocked, CSP misconfig, `host` / `shop` missing from a
dropped query string) or on a non-embedded hit on the root. An error boundary
that throws its own `TypeError` on `shopify.toast` because App Bridge isn't there
defeats its purpose. So: the error UI must **render** without App Bridge, and may
**enhance** with it behind a feature check —
`if (typeof window !== 'undefined' && window.shopify) { … }`, no top-level
unguarded `shopify.*` calls.

The `_authenticated` layout gets no error boundary of its own — its only failure
mode is `throw redirect`, which is control flow, not an error.

## Why

- **Hand-written head over a helper.** The three tags are load-bearing and easy to
  break, but they are three lines in the one file (`__root.tsx`) a template owner
  always reads and edits. A `shopifyHeadTags()` helper hides the exact thing the
  prototype showed you must not get wrong. The package documents the rule instead.
- **No `<Page>` wrapper.** A wrapper that imperatively wired slotted actions would
  make the safe path the default path — but it also dictates page structure in a
  starter whose job is to hand that control to the dev. `suppressHydrationWarning`
  on `<html>` already covers the hydration wedge; the slot caveat is guidance, not
  a reason to abstract.
- **`<s-app-nav>` over `<NavMenu>`.** Once the TypeScript shim lands, `<s-app-nav>`
  is a pure-CDN web component with no React dependency — the same stack as the
  rest of the Polaris surface. `<NavMenu>` (from `@shopify/app-bridge-react`)
  works too and stays permitted, but pulling a React binding in for one element
  when the web component works is avoidable.
- **CSP in the middleware, not `__root`.** The middleware is the only place with
  the decoded `shop` on every document request and is already the
  response-header seam (ADR 0002). Splitting header logic between it and `__root`
  would be two places to keep the shop allowlist correct.
- **Error boundary guards App Bridge rather than banning it.** Using `<s-*>` keeps
  the error UI consistent and is safe because `polaris.js` load is independent of
  route success. `window.shopify` is genuinely available in the usual failure
  cases (loader throw, render error, server `500` in an authenticated session), so
  the boundary may use it — behind a feature check, because one failure mode it
  must survive is App Bridge init itself not completing.

## Considered and rejected

- **`head({ scripts })` for the CDN tags.** Rejected: `<HeadContent />` reorders
  them ahead of a late `<meta shopify-api-key>` and the `async` flag removes the
  before-hydration guarantee. Prototype-confirmed to break auth silently.
- **`shopifyHeadTags()` / `<ShopifyAppHead>` helper in the package.** Considered
  for encapsulating the ordering rule; rejected as hiding load-bearing detail in a
  template, against the "minimal abstraction, dev keeps control" preference for
  this effort.
- **`<Page>` wrapper populating slots via `useEffect`.** Rejected: over-abstraction
  for a starter; `suppressHydrationWarning` on `<html>` already prevents the wedge.
- **`<NavMenu>` from `@shopify/app-bridge-react` as the nav.** Known-good and still
  permitted, but adds a React dependency for one element the web component now
  covers.
- **CSP in `__root` `headers()` or a Nitro route rule.** Rejected: neither has the
  decoded `shop`; would duplicate the allowlist logic that already lives in the
  middleware.
- **Non-embedded `/` marketing route now.** Out of scope; the `/app/*` mount
  leaves room for it later without dictating it.

## Consequences

- **ENG-2331** places the concrete files: `_authenticated/app/*` pages, the
  `/auth/login` + `/auth/$` routes, and owns the global-middleware
  **path-exclusion list** (a public route not on it is forced through embedded
  auth). It also owns GraphQL codegen and the `__root` `beforeLoad` that copies
  `{ shop, isAuthenticated }` from `serverContext` into router context.
- **ENG-2325** gains two `/react` exports (JSX shim `.d.ts`, `useShopify()`) and
  must reference the shim `.d.ts` from the package types.
- **ENG-2332** owns the deferred `no-restricted-imports` / oxlint rule that
  forbids `@shopify/polaris`, plus the unresolved **prod-serve gap** from the
  prototype (`node .output/server/index.mjs` still referenced the dev virtual
  client entry — a correct Nitro preset / `vite preview` path is unverified).
- `@shopify/polaris` (React) is a forbidden dependency; `@shopify/app-bridge-react`
  is allowed but unused by the shell.
- Embedded hydration is a few seconds slower than a direct load — anything
  asserting on post-hydration state (tests, first-paint checks) must allow for it.
- `--use-localhost` does not embed cleanly (untrusted mkcert cert → `null` origin
  in the third-party iframe); embedded dev requires the `shopify app dev`
  cloudflare tunnel.
