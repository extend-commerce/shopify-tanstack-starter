# Auth boundary and bounce control flow

Token-exchange + managed-install auth is enforced at **two** layers, and the
unauthenticated-bounce decision is **not** made where React Router makes it.

- **Global `requestMiddleware`** (registered in `src/start.ts` via `createStart`) runs
  the eager pipeline for every SSR and server-route request whose path is not on an
  exclusion list (`/auth/*`, webhook routes, app-proxy/public endpoints): when a
  session token is present it decodes it, loads the offline session, and — if the
  stored token is missing or within `WITHIN_MILLISECONDS_OF_EXPIRY` (`5 * 60 * 1000`)
  of expiry — refreshes or runs token exchange, stores the result, and fires
  `afterAuth` once. Concurrent requests for one shop are de-duplicated by an in-flight
  `Map`; `afterAuth` idempotency uses a 60 s TTL handler.
- **`adminMiddleware`** (function middleware) is attached to every `createServerFn`
  that touches the Admin API. It repeats the load/ensure-active check against the
  request's Bearer token, builds the `admin` client, and on an Admin API `401`
  invalidates the stored token and returns the retry response.
- **Bounce** (embedded document request with no usable session token): the global
  middleware does **not** throw. A pathless `_authenticated` layout's `beforeLoad`
  sees `isAuthenticated: false` and `throw redirect()`s to `/auth/session-token`; the
  `/auth/$` splat route renders the App Bridge `shopify-reload` HTML. A non-embedded
  document request is redirected to `api.auth.getEmbeddedAppUrl`.

## Why

- **Two layers, not one.** ENG-2325 already routes all Admin access through server
  functions carrying `adminMiddleware`, so that is the real per-call boundary. The
  global middleware is kept anyway as a single choke point that cannot be forgotten
  and so SSR of any route has the session loaded; the cost is the path-exclusion list.
  Neither reference implementation keeps a global middleware
  (`@yan-ad/shopify-app-tanstack` targets TanStack Router, not Start;
  `tanstack-start-shopify-app-boilerplate` deliberately limits `src/start.ts` to
  CSRF/bot/logging) — this project accepts that divergence for the choke-point
  guarantee.
- **Bounce in `beforeLoad`, not the auth pipeline.** React Router renders the bounce
  HTML from inside `authenticate.admin`; a reader porting from RR will expect the same.
  In TanStack the idiomatic control flow for "unauthenticated UI" is a `beforeLoad`
  that `throw redirect()`s, and it runs both during SSR and on client navigation, so
  the bounce lives there and the `/auth/$` route owns the HTML.

## Considered and rejected

- **Function middleware as the sole boundary** (the boilerplate's model). Simpler,
  no exclusion list, matches the TanStack docs. Rejected for the single-choke-point
  property.
- **Faithful `authenticate.*` port** (`@yan-ad/shopify-app-tanstack`'s model).
  Rejected in ADR 0001; reaffirmed here — that package targets Router-not-Start and
  its own doc examples are still un-migrated Remix `action`s.

## Consequences

- The global middleware's exclusion list is load-bearing: a new public/unauthenticated
  route that is not added to it will be forced through embedded-auth and break.
- The in-flight de-dupe `Map` and the `afterAuth` idempotency handler are in-memory —
  a multi-instance deployment can double-run `afterAuth` within the TTL window.
  Acceptable for the starter; noted for the deferred deployment effort (ENG-2333).
- `_authenticated.beforeLoad` reads a client-safe `{ shop, isAuthenticated }` from
  dehydrated router context (populated by the middleware during SSR). An expired
  token that slips past is caught on the next `adminMiddleware` server-fn call as a
  `401` + `X-Shopify-Retry-Invalid-Session-Request`, which App Bridge retries.
