# TanStack-idiomatic package surface over React Router API parity

`packages/shopify-app-tanstack-start` gives a TanStack Start app the same Shopify
capabilities that `@shopify/shopify-app-react-router` gives a React Router app. We
decided its public surface is **middleware and handler factories**, not a port of
RR's `shopifyApp()` return shape (`authenticate.admin`, `authenticate.webhook`,
etc.). `createShopifyApp(config)` returns composable primitives — `requestMiddleware`
(registered in `src/start.ts`), `adminMiddleware` (attached to Admin-touching
`createServerFn`s), and `handlers.{webhooks,auth}` (mounted as server routes) — plus
`unauthenticated.*`, `registerWebhooks`, and `addDocumentResponseHeaders`. We chose
this because TanStack Start's data boundary is request/function middleware and server
routes, `beforeLoad` is UX-only, and its per-request `serverContext` is SSR-only; an
`authenticate.admin`-style helper would exist only to mimic Remix and would fight all
three of those facts.

## Considered options

- **Port RR's `authenticate.*` / `unauthenticated.*` object as the public contract.**
  Rejected: familiar to RR-template users but structurally mismatched — it implies a
  loader/action call site TanStack doesn't have, and hides where the real data
  boundary is.
- **Router-context factory feeding `handler.fetch({ context })` +
  `createRootRouteWithContext`.** Rejected as the *primary* seam: `serverContext` is
  populated only during SSR and is absent on client navigations, so the session would
  silently vanish after hydration.
- **Middleware + handler factories (chosen).** Matches the framework; the cost is that
  RR-template users must learn a new call site.

## Consequences

- All Admin API access flows through server functions carrying `adminMiddleware`;
  loaders call those server functions. Access tokens never ride on `beforeLoad`
  return values or `serverContext`.
- Config keeps RR's `AppConfigArg` field *names* (low switching cost from the RR
  template) but drops the legacy-OAuth `begin`/`callback` surface and `restResources`.
  `distribution` is kept for `AppStore` + `SingleMerchant`; `ShopifyAdmin`
  (merchant-custom-app strategy) throws as out of scope.
- The package depends only on `@shopify/shopify-api` +
  `@shopify/shopify-app-session-storage` and stays runtime-agnostic (Web
  `Request`/`Response`, `@shopify/shopify-api/adapters/web-api`, no `node:*` in shared
  code), so a later Cloudflare/Lambda target is a preset swap, not a rewrite.
