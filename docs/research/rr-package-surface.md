# Map of `@shopify/shopify-app-react-router`

**Ticket:** [ENG-2322](https://linear.app/extend-commerce/issue/ENG-2322/map-the-shopifyshopify-app-react-router-package-surface)
**Question:** From `Shopify/shopify-app-js` source, inventory what `@shopify/shopify-app-react-router` provides and how; classify framework glue vs `@shopify/shopify-api` reuse.
**Date:** 2026-08-28
**Clone:** `https://github.com/Shopify/shopify-app-js` @ `c92c01fdf0b52ac4c57bee2517050997ec934b8a` (shallow `main`, `/tmp/shopify-app-js`; not vendored)

---

## Decisions so far

Port **token exchange + managed installation** as TanStack Start glue. Keep `SessionStorage` as the persistence seam. Depend on `@shopify/shopify-api` + `@shopify/shopify-app-session-storage`; do **not** copy this package's React Router API. There is no `authenticate.storefront` / `authenticate.customerAccount` top-level API — those live under `unauthenticated.storefront` and `authenticate.public.*`.

---

## Versions

Recorded from package source **and** the published npm registry (both agree):

| Package | Version | Engines / peers |
|---|---|---|
| `@shopify/shopify-app-react-router` | **2.0.0** | Node `>=22`; peers `react`/`react-dom` `>=18`, `react-router` `^7.6.2` |
| `@shopify/shopify-api` | **14.0.0** | Node `>=22` |
| `@shopify/shopify-app-session-storage` | **6.0.0** | peer `@shopify/shopify-api` `^14.0.0` |

RR also depends on `@shopify/admin-api-client` `^2.0.0` and `@shopify/storefront-api-client` `^2.0.0` (types for `AdminOperations` / `StorefrontOperations`).

Library version string: `SHOPIFY_REACT_ROUTER_LIBRARY_VERSION = '2.0.0'` in `packages/apps/shopify-app-react-router/src/server/version.ts`.

v2.0.0 (CHANGELOG) dropped non-embedded apps: `shopifyApp` **rejects** `isEmbeddedApp`; `AppProvider` always injects App Bridge and requires `apiKey`.

---

## 1. Public entry points

Source: `packages/apps/shopify-app-react-router/package.json` `exports`.

| Subpath | File | Purpose |
|---|---|---|
| `@shopify/shopify-app-react-router/server` (also package `main`/`types`) | `src/server/index.ts` | Server factory, auth, types, re-exports from `@shopify/shopify-api` |
| `@shopify/shopify-app-react-router/react` | `src/react/index.ts` | `AppProvider`, `AppProxyProvider`, `AppProxyLink` |
| `@shopify/shopify-app-react-router/test-helpers` | `src/server/test-helpers/index.ts` | `testConfig()` dummy config for tests |
| `@shopify/shopify-app-react-router/adapters/*` and `/server/adapters/*` | `src/server/adapters/node/index.ts` | Node runtime string + optional `APP_BRIDGE_URL` override |

`/server` side-effect: imports `@shopify/shopify-api/adapters/web-api` and sets `setAbstractRuntimeString(() => 'React Router')`. The Node adapter only changes the runtime string to `React Router (Node)` and optionally overrides App Bridge URL from `process.env.APP_BRIDGE_URL`.

### `/server` exports (`src/server/index.ts`)

From this package:

- `shopifyApp` — factory
- `boundary` — `{ error, headers }` React Router error/headers helpers
- `AppDistribution`, `LoginErrorType` — enums
- Types: `ShopifyApp`, `LoginError`, plus everything in `types-contexts.ts`
- `SessionNotFoundError`

Re-exported from `@shopify/shopify-api`:

- Values: `LogSeverity`, `DeliveryMethod`, `BillingInterval`, `BillingReplacementBehavior`, `ApiVersion`, `Session`
- Type: `JwtPayload`

### `/react` exports

- `AppProvider` / `AppProviderProps`
- `AppProxyProvider` / `AppProxyProviderProps` / `AppProxyProviderContext`
- `AppProxyLink` / `AppProxyLinkProps`

There is **no** Polaris React package dependency. Polaris is a CDN script (`polaris.js` web components). App Bridge is a CDN script (`app-bridge.js`).

---

## 2. `shopifyApp(config)` — config and return value

### Config object (`AppConfigArg`)

Source: `src/server/config-types.ts` + omitted/added fields from `@shopify/shopify-api` `ConfigParams` (`lib/base-types.ts`).

RR **omits** from `ConfigParams`: `hostName`, `hostScheme`, `apiVersion` (then re-adds it as required), `isCustomStoreApp`, `isEmbeddedApp`, `future`, `billing`, `restResources`.

RR **adds**:

| Field | Required | Notes |
|---|---|---|
| `appUrl` | yes | Parsed to origin; becomes `hostName`/`hostScheme` for `shopifyApi` |
| `apiVersion` | yes | `ApiVersion` enum |
| `apiSecretKey` | yes | from `ConfigParams` |
| `apiKey` | typical | required for token exchange / install URLs |
| `sessionStorage` | yes unless `distribution === ShopifyAdmin` | `SessionStorage` seam |
| `scopes` | optional | “Not required if using Shopify managed installation” (`ConfigParams` JSDoc) |
| `useOnlineTokens` | no, default `false` | When true, both offline **and** online tokens are stored |
| `webhooks` | no | `Record<string, WebhookHandler \| WebhookHandler[]>` → `api.webhooks.addHandlers` |
| `hooks.afterAuth` | no | `( { session, admin } ) => void` after first successful token exchange |
| `billing` | no | line-item plan map (`BillingConfigWithLineItems`) |
| `distribution` | no, default `AppDistribution.AppStore` | `app_store` \| `single_merchant` \| `shopify_admin` |
| `authPathPrefix` | no, default `"/auth"` | Must match a splat route that calls `authenticate.admin` |
| `future` | no | currently only `expiringOfflineAccessTokens?: boolean` |
| plus remaining `ConfigParams` | | `userAgentPrefix`, `logger`, `adminApiAccessToken`, `privateAppStorefrontAccessToken`, `domainTransformations`, `isTesting`, `cookiePath` |

`deriveApi` (`shopify-app.ts`) always passes `isEmbeddedApp: true` and `isCustomStoreApp: distribution === ShopifyAdmin`. Passing `isEmbeddedApp` in config **throws**.

Derived `config.auth` paths:

```
path:                  {authPathPrefix}              // default /auth
callbackPath:          {authPathPrefix}/callback     // unused by token-exchange strategy
patchSessionTokenPath: {authPathPrefix}/session-token  // bounce page
exitIframePath:        {authPathPrefix}/exit-iframe
loginPath:             {authPathPrefix}/login
```

### Return value (`ShopifyApp<Config>`)

Source: `src/server/shopify-app.ts` + `src/server/types.ts`.

Always:

```
{
  sessionStorage,                 // the instance you passed in
  addDocumentResponseHeaders,     // CSP + Link preload for App Bridge / Polaris
  registerWebhooks,               // api.webhooks.register({ session })
  authenticate: {
    admin,                        // token exchange (or merchant-custom)
    flow,
    fulfillmentService,
    pos,
    public: { checkout, appProxy, customerAccount },
    webhook,
  },
  unauthenticated: {
    admin,                        // (shop: string) → offline Admin client
    storefront,                   // (shop: string) → offline Storefront client
  },
}
```

Also `login(request)` when `distribution` is `AppStore` or `SingleMerchant` (not `ShopifyAdmin`).

There is **no** `authenticate.storefront`. Storefront GraphQL is reached via `unauthenticated.storefront(shop)` or `authenticate.public.appProxy` (when a session exists).

There is **no** top-level `authenticate.customerAccount`. It is `authenticate.public.customerAccount`. That helper returns a **session token + CORS**, not a Customer Account API client.

---

## 3. `authenticate.*` implementations

Control flow is “throw `Response` / `redirect()`”. Callers use React Router `ErrorBoundary` + `boundary.error` to render bounce/exit-iframe HTML.

### 3.1 `authenticate.admin(request)` — **must port**

Source: `src/server/authenticate/admin/authenticate.ts` (`authStrategyFactory`).

Pipeline:

1. Reject bots (`isbot`, allow Shopify POS/Mobile UAs) → 410.
2. OPTIONS → 204 + CORS.
3. If path ends with `patchSessionTokenPath` → throw bounce HTML (`renderAppBridge`).
4. If path ends with `exitIframePath` → throw App Bridge HTML that `window.open`s `?exitIframe=`.
5. If **no** `Authorization: Bearer` header (document request):
   - `validateShopAndHostParams`
   - If `embedded !== '1'` → redirect to Shopify Admin embedded URL (`api.auth.getEmbeddedAppUrl`)
   - If embedded but no `id_token` query → bounce page
6. Resolve session token from `Authorization: Bearer` **or** `?id_token=`
7. `validateSessionToken` → `api.session.decodeSessionToken` (HS256, `apiSecretKey`, `aud === apiKey`)
8. Shop = hostname of JWT `dest`; session id = `api.session.getOfflineId(shop)` or `getJwtSessionId(shop, sub)` if online tokens
9. `sessionStorage.loadSession(sessionId)`
10. Strategy `authenticate(request, { session, sessionToken, shop })`
11. Return `AdminContext`

Returned `AdminContext` (embedded / App Store):

```
{
  session,          // Session
  sessionToken,     // JwtPayload
  admin,            // { graphql }
  billing,          // { require, check, request, cancel, createUsageRecord, updateUsageCappedAmount }
  cors,             // (Response) => Response
  redirect,         // App-Bridge-aware redirect
  scopes,           // { query, request, revoke }
}
```

`ShopifyAdmin` distribution omits `sessionToken` and `redirect`.

### 3.2 Token-exchange strategy — **glue around API**

Source: `src/server/authenticate/admin/strategies/token-exchange.ts`. Selected unless `distribution === ShopifyAdmin`.

`createTokenExchangeStrategy(params).authenticate`:

- Requires `sessionToken`.
- If no stored session **or** `!session.isActive(undefined, 5 * 60 * 1000)`:
  1. `api.auth.tokenExchange({ sessionToken, shop, requestedTokenType: OfflineAccessToken, expiring: future.expiringOfflineAccessTokens })`
  2. `sessionStorage.storeSession(offlineSession)`
  3. If `useOnlineTokens`: second exchange with `OnlineAccessToken`, store that too, return the online session
  4. Run `hooks.afterAuth` once per session-token (in-memory `IdempotentPromiseHandler`, 60s TTL)
- Else return the existing session.

Invalid JWT / Shopify `400 invalid_subject_token` → bounce (document) or **401** with `X-Shopify-Retry-Invalid-Session-Request: 1` (XHR). Other errors → 500.

On GraphQL **401**: `invalidateAccessToken` (clears `session.accessToken` and `storeSession`) then same invalid-token response.

**There is no OAuth `begin`/`callback` in this package.** `api.auth.begin` / `api.auth.callback` exist on `@shopify/shopify-api` but RR never calls them. `config.auth.callbackPath` is derived and unused by the token-exchange path.

### 3.3 Managed installation — **glue (URLs) + Shopify Admin**

Two install-URL builders:

1. **`login(request)`** (`authenticate/login/login.ts`): sanitizes `shop`, then redirects to  
   `https://admin.shopify.com/store/{shop}/oauth/install?client_id={apiKey}`
2. **`scopes.request` / `redirectToInstallPage`**:  
   `https://{shop}/admin/oauth/install?client_id={apiKey}&scope={scopes}&optional_scopes=...`  
   thrown as App Bridge 401 `X-Shopify-API-Request-Failure-Reauthorize-Url` (embedded XHR) or RR `redirect` (Admin custom apps).

After the merchant installs, Admin loads the app embedded; App Bridge supplies a session token; token exchange mints the access token. That **is** managed installation.

### 3.4 Bounce / embedded redirect — **must port**

| Helper | File | Behavior |
|---|---|---|
| `redirectToBouncePage` | `admin/helpers/redirect-to-bounce-page.ts` | Strip `id_token`, set `shopify-reload={appUrl}{path}?{params}`, `redirect` to `/auth/session-token?...` |
| `renderAppBridge` | `admin/helpers/render-app-bridge.ts` | HTML: `<script data-api-key src=app-bridge.js>` (+ optional `window.open`). App Bridge reloads via `shopify-reload` |
| `respondToInvalidSessionToken` | `helpers/respond-to-invalid-session-token.ts` | Document → bounce; XHR → 401 (+ retry header) |
| `ensureAppIsEmbeddedIfRequired` | `admin/helpers/ensure-app-is-embedded-if-required.ts` | Non-embedded document → `api.auth.getEmbeddedAppUrl` |
| `redirect` on context | `admin/helpers/redirect.ts` | Copies embedded query params on same origin; `_self` vs App Bridge headers vs `window.open` |
| `redirectOutOfApp` | `admin/billing/helpers.ts` | Billing confirmation: XHR 401 + reauth header, or `/auth/exit-iframe?exitIframe=` |

Bounce page **must** be served by a route that calls `authenticate.admin` (the splat `$` under `authPathPrefix`).

### 3.5 `authenticate.webhook(request)` — **glue around API**

Source: `authenticate/webhooks/authenticate.ts`.

1. Non-POST → 405
2. `rawBody = request.text()`
3. **`api.webhooks.validate({ rawBody, rawRequest })`** — HMAC + required headers (`shopify-api` `lib/webhooks/validate.ts` → `validateHmacFromRequestFactory`)
4. Invalid HMAC → 401; other validation fail → 400
5. `ensureValidOfflineSession(shop)` — may be `undefined` (app already uninstalled)
6. Return `{ apiVersion, shop, topic, webhookId, payload, webhookType, session?, admin?, ... }`

Handler **registration**:

- Config `webhooks` → `api.webhooks.addHandlers` at `shopifyApp()` init
- `registerWebhooks({ session })` → `api.webhooks.register({ session })` (Admin GraphQL subscribe). Typical call site: `hooks.afterAuth`

App-specific webhooks in `shopify.app.toml` skip `addHandlers`/`register`; `authenticate.webhook` still validates HMAC.

### 3.6 `authenticate.public`

Factory: `authenticate/public/factory.ts`.

| Method | Implementation | Returns |
|---|---|---|
| `checkout(request, { corsHeaders? })` | Shared extension helper | `{ sessionToken, cors }` |
| `customerAccount(request, { corsHeaders? })` | Same helper (`checkAudience: false`) | `{ sessionToken, cors }` |
| `appProxy(request)` | HMAC via `api.utils.validateHmac(searchParams, { signator: 'appProxy' })` (retries RR `_data` query shapes) | `{ liquid, session?, admin?, storefront? }` |

Extension helper (`public/extension/authenticate.ts`): bot + OPTIONS, require Bearer token, `validateSessionToken` with `checkAudience: false`. **No Admin/Storefront/Customer Account GraphQL client.**

App proxy is the only public method that constructs Admin + Storefront clients (offline session).

### 3.7 `authenticate.pos` / `.flow` / `.fulfillmentService`

- **pos**: same extension helper as checkout (`authenticate/pos/authenticate.ts`).
- **flow**: POST; `api.flow.validate`; load offline session; `{ session, payload, admin }`. Missing session → 400.
- **fulfillmentService**: POST; `api.fulfillmentService.validate`; shop from `X-Shopify-Shop-Domain`; `{ session, payload, admin }`.

### 3.8 `unauthenticated.admin(shop)` / `unauthenticated.storefront(shop)`

Load/create offline session (`ensureValidOfflineSession`), throw `SessionNotFoundError` if missing, return `{ session, admin }` or `{ session, storefront }`.

`ensureValidOfflineSession`:

1. `createOrLoadOfflineSession` — `loadSession(api.session.getOfflineId(shop))` (or `customAppSession` for Admin distribution)
2. If `future.expiringOfflineAccessTokens` and token near expiry and `refreshToken` present → **`api.auth.refreshToken({ shop, refreshToken })`** and `storeSession`

---

## 4. Token exchange + session-token validation (API calls)

### Session token

`api.session.decodeSessionToken(token, { checkAudience })` (`shopify-api` `lib/session/decode-session-token.ts`):

- `jose.jwtVerify` HS256 with HMAC of `apiSecretKey`
- 10s clock tolerance
- Optional `payload.aud === apiKey`
- Payload: `iss`, `dest`, `aud`, `sub`, `exp`, `nbf`, `iat`, `jti`, `sid` (`JwtPayload`)

Token location (`get-session-token-header.ts`):

- Header: `Authorization: Bearer <jwt>` (App Bridge fetch)
- Query: `id_token` (first document load / bounce reload)

### Token exchange

`api.auth.tokenExchange` (`shopify-api` `lib/auth/oauth/token-exchange.ts`):

1. Decode session token (validates JWT before POST)
2. POST `https://{shop}/admin/oauth/access_token` with:
   - `grant_type`: `urn:ietf:params:oauth:grant-type:token-exchange`
   - `subject_token`: session token
   - `subject_token_type`: `urn:ietf:params:oauth:token-type:id_token`
   - `requested_token_type`: `urn:shopify:params:oauth:token-type:offline-access-token` or `...online-access-token`
   - `expiring`: `'1'` \| `'0'`
3. `createSession` builds `Session` (`id` = `offline_{shop}` or `{shop}_{userId}`, `accessToken`, `scope`, `expires`, optional `refreshToken` / `onlineAccessInfo`)

RR then **stores** that `Session` via `SessionStorage.storeSession`.

### Refresh (expiring offline tokens)

`api.auth.refreshToken` POSTs `grant_type=refresh_token` to the same access_token endpoint. Glue: `src/server/helpers/refresh-token.ts` + `ensure-offline-token-is-not-expired.ts`.

---

## 5. Admin / Storefront / Customer-account clients

### Admin (`AdminApiContext`)

`src/server/clients/admin/factory.ts` + `graphql.ts`.

```
admin.graphql(operation, { variables, apiVersion, headers, tries, signal })
  → new api.clients.Graphql({ session, apiVersion }).request(...)
  → new Response(JSON.stringify(apiResponse))
```

Typed as `GraphQLClient<AdminOperations>` (`@shopify/admin-api-client`). REST is **not** exposed; `restResources` is omitted from RR config.

`GraphqlClient` (`shopify-api` `lib/clients/admin/graphql/client.ts`) uses `session.accessToken` (or `config.adminApiAccessToken` for custom apps) via `createAdminApiClient`.

401 handling is **glue**: `handleClientErrorFactory` maps `HttpResponseError` to a thrown `Response` with the upstream status, after the strategy's `onError` (token invalidation + bounce).

### Storefront (`StorefrontContext`)

`src/server/clients/storefront/factory.ts`:

```
storefront.graphql(query, options)
  → new api.clients.Storefront({ session, apiVersion }).request(...)
  → new Response(JSON.stringify(apiResponse))
```

Typed as `GraphQLClient<StorefrontOperations>`. Used by `unauthenticated.storefront` and `authenticate.public.appProxy` only.

### Customer Account

**No GraphQL client in this package.** `authenticate.public.customerAccount` only validates the extension session token. A TanStack port that needs Customer Account API would add that itself (or via `@shopify/shopify-api` if/when a client exists there) — it is not RR glue to copy.

---

## 6. Billing helpers

Attached to `authenticate.admin` context (`admin/billing/*`). Each method is a thin wrapper:

| Helper | Delegates to | Extra glue |
|---|---|---|
| `billing.check` | `api.billing.check({ session, plans, isTest, returnObject: true })` | 401 → invalidate + bounce |
| `billing.require` | same `check` | if `!hasActivePayment` → `onFailure(error)` (often `billing.request`) |
| `billing.request` | `api.billing.request({ plan, session, returnObject: true, ... })` | throw `redirectOutOfApp` to `confirmationUrl` |
| `billing.cancel` | `api.billing.cancel` | 401 handling |
| `billing.createUsageRecord` | `api.billing.createUsageRecord` | 401 handling |
| `billing.updateUsageCappedAmount` | `api.billing.updateUsageCappedAmount` | redirect out of app like `request` |

Plan names are keys of `config.billing`. Intervals/enums come from `@shopify/shopify-api` (`BillingInterval`, etc.).

---

## 7. App Bridge / Polaris integration points

**Server (must port as framework glue):**

- `addDocumentResponseHeaders`: `Link` preload of App Bridge + Polaris CDN; CSP `frame-ancestors https://{shop} https://admin.shopify.com ...` for embedded apps (`authenticate/helpers/add-response-headers.ts`).
- Bounce / exit-iframe HTML injects `https://cdn.shopify.com/shopifycloud/app-bridge.js` with `data-api-key`.
- `X-Shopify-API-Request-Failure-Reauthorize-Url` (`REAUTH_URL_HEADER`) and `X-Shopify-Retry-Invalid-Session-Request` — App Bridge client intercepts these.
- `boundary.error` renders thrown `ErrorResponse` HTML (bounce page) via `dangerouslySetInnerHTML`.
- `boundary.headers` merges parent/loader/action/error headers so CSP/Link survive.

**React (`/react`) — port to TanStack Router equivalents:**

- `AppProvider`: injects App Bridge script + `https://cdn.shopify.com/shopifycloud/polaris.js`; listens for `shopify:navigate` and calls **`useNavigate()` from `react-router`**. That hook is the framework-specific bit.
- `AppProxyProvider`: `<base href={appUrl}>` + URL formatter for proxied relative links.
- `AppProxyLink`: `<a href={formatUrl(href)}>` inside the provider.

Constants: `APP_BRIDGE_URL`, `POLARIS_URL` (`src/server/authenticate/const.ts`, `src/shared/const.ts`).

There is **no** `@shopify/app-bridge-react` or `@shopify/polaris` npm integration.

---

## 8. `SessionStorage` + `Session` contract

Keep this as the persistence seam. Do not reimplement adapters; use `@shopify/shopify-app-session-storage` (+ a concrete package, or a custom impl).

### `SessionStorage` (`packages/apps/session-storage/shopify-app-session-storage/src/types.ts`)

```ts
interface SessionStorage {
  storeSession(session: Session): Promise<boolean>;
  loadSession(id: string): Promise<Session | undefined>;
  deleteSession(id: string): Promise<boolean>;
  deleteSessions(ids: string[]): Promise<boolean>;
  findSessionsByShop(shop: string): Promise<Session[]>;
}
```

The package also exports RDBMS migrator helpers (`SessionStorageMigrator`, `RdbmsConnection`, …). Those are for storage adapters, not RR glue.

### `Session` (`@shopify/shopify-api` `lib/session/session.ts`)

Constructor fields (`SessionParams`):

| Field | Notes |
|---|---|
| `id` | `offline_{shop}` or `{shop}_{userId}` |
| `shop` | e.g. `example.myshopify.com` |
| `state` | OAuth leftover; token exchange sets `''` |
| `isOnline` | boolean |
| `scope?` | string |
| `expires?` | `Date` |
| `accessToken?` | string |
| `refreshToken?` | expiring offline tokens |
| `refreshTokenExpires?` | `Date` |
| `onlineAccessInfo?` | associated user, `expires_in`, … |

Methods used by RR: `isActive(scopes, withinMs)`, `isExpired(withinMs)`, `isScopeChanged` / `isScopeIncluded`, `toObject`, `toPropertyArray`, `equals`. `fromPropertyArray` for DB round-trip.

RR expiry slack: `WITHIN_MILLISECONDS_OF_EXPIRY = 5 * 60 * 1000` (`helpers/ensure-offline-token-is-not-expired.ts`). Token-exchange “needs new token” uses the same constant via `session.isActive(undefined, WITHIN_MILLISECONDS_OF_EXPIRY)`.

---

## 9. Classification table

| Responsibility | Classification | Source | Port notes |
|---|---|---|---|
| `shopifyApi(config)` instance | **Reuse** | `@shopify/shopify-api` `shopifyApi` | Construct once from env |
| Web API / Node runtime adapter | **Reuse** | `@shopify/shopify-api/adapters/web-api` | Import for Fetch `Request` |
| Map `appUrl` → `hostName`/`hostScheme`, force embedded | **Glue** | `shopify-app.ts` `deriveApi` / `deriveConfig` | Tiny config mapper |
| `SessionStorage` interface + adapters | **Reuse (seam)** | `@shopify/shopify-app-session-storage` | Keep as-is |
| `Session` class + ids (`getOfflineId`, `getJwtSessionId`) | **Reuse** | `api.session.*` | |
| Decode/validate session JWT | **Reuse** | `api.session.decodeSessionToken` | Glue: where token lives (header vs query) |
| Token exchange HTTP | **Reuse** | `api.auth.tokenExchange` | |
| Refresh expiring offline token | **Reuse** | `api.auth.refreshToken` | Glue: when to call + store |
| When to exchange / store / afterAuth | **Glue (must port)** | `strategies/token-exchange.ts` | Core auth |
| Managed install URLs (`/admin/oauth/install`) | **Glue (must port)** | `login.ts`, `redirect-to-install-page.ts` | No API call |
| Bounce page + `shopify-reload` | **Glue (must port)** | `redirect-to-bounce-page.ts`, `renderAppBridge` | TanStack redirect/Response |
| Exit-iframe page | **Glue (must port)** | `authenticate.ts` + `renderAppBridge` | |
| Embed check (`embedded=1` / `getEmbeddedAppUrl`) | **Glue** | `ensure-app-is-embedded-if-required.ts` | `api.auth.getEmbeddedAppUrl` reused |
| `throw Response` / `redirect()` auth control flow | **Glue (must port)** | throughout `authenticate/` | Map to TanStack `redirect` / thrown `Response` |
| Bot / OPTIONS / CORS | **Glue** | `reject-bot-request`, `respond-to-options-request`, `ensure-cors-headers` | Small |
| `addDocumentResponseHeaders` CSP + preload | **Glue (must port)** | `add-response-headers.ts` | entry.server equivalent |
| `boundary.error` / `boundary.headers` | **Glue** | `server/boundary/*` | TanStack error component + headers |
| Admin GraphQL HTTP | **Reuse** | `api.clients.Graphql` | |
| Wrap GraphQL result as `Response` + typed `graphql()` | **Glue** | `clients/admin/graphql.ts` | Optional DX; can call client directly |
| Storefront GraphQL HTTP | **Reuse** | `api.clients.Storefront` | Same wrapper pattern |
| Customer Account API client | **N/A in RR** | — | Not shipped; don't invent from this package |
| Webhook HMAC + header parse | **Reuse** | `api.webhooks.validate` | |
| Webhook handler registry + GraphQL subscribe | **Reuse** | `api.webhooks.addHandlers` / `.register` | |
| Webhook route (POST-only, 401/400, load session, admin client) | **Glue** | `authenticate/webhooks/authenticate.ts` | |
| App-proxy HMAC | **Reuse** | `api.utils.validateHmac(..., { signator: 'appProxy' })` | Glue: RR `_data` query retries |
| Flow / fulfillment HMAC | **Reuse** | `api.flow.validate`, `api.fulfillmentService.validate` | Glue: session load + 4xx |
| Public extension session-token auth | **Glue** | `public/extension/authenticate.ts` | Thin JWT wrapper |
| Billing GraphQL mutations/queries | **Reuse** | `api.billing.*` | |
| Billing `require`/`request` redirect-out-of-app | **Glue** | `admin/billing/*` | Same bounce/exit-iframe |
| Scopes query/revoke GraphQL | **Glue wrapping Admin client** | `admin/scope/*` | Optional; `request` uses install URL |
| `AppProvider` App Bridge + Polaris scripts | **Glue (must port)** | `react/components/AppProvider` | Use TanStack `useNavigate` for `shopify:navigate` |
| `AppProxyProvider` / `AppProxyLink` | **Glue** | `react/components/*` | Only if app proxies are in scope |
| Merchant-custom (`ShopifyAdmin`) strategy | **Out of scope** | `strategies/merchant-custom-app.ts` | Token exchange only |
| OAuth code grant `begin`/`callback` | **Do not port** | exists on `api.auth` but unused by RR | Ticket: token exchange only |
| REST Admin resources | **Do not port** | omitted by RR | |

---

## 10. Implications for the port

### Must reimplement as TanStack glue

1. **Auth middleware / server helpers** that, given a `Request`:
   - Read session token from Bearer or `id_token`
   - Validate via `api.session.decodeSessionToken`
   - Load `Session` from `SessionStorage`
   - Call `api.auth.tokenExchange` when missing/expired
   - `storeSession` offline (and online if configured)
   - Fire `afterAuth` once
   - On document requests without a token: bounce HTML or embed redirect
   - On invalid token XHR: 401 + App Bridge retry/reauth headers
2. **Routes** equivalent to RR `auth/.$`:
   - Bounce (`/auth/session-token`) and exit-iframe (`/auth/exit-iframe`) must hit the same authenticate helper so App Bridge can complete the loop.
3. **Document headers** (CSP `frame-ancestors`, App Bridge/Polaris preload) on HTML responses.
4. **Root layout script tags** for App Bridge + Polaris, plus `shopify:navigate` → TanStack Router navigation (not `react-router`'s `useNavigate`).
5. **Webhook action** that is POST-only, calls `api.webhooks.validate`, optionally loads offline session, returns 401/400/405.
6. **Login** (optional): shop form → `https://admin.shopify.com/store/{shop}/oauth/install?client_id=`.
7. **Thrown Response as control flow** mapped onto TanStack Start (`redirect`, status responses, error boundaries that can render bounce HTML).

Do **not** clone RR's `shopifyApp()` return shape as a public contract. Name helpers in a TanStack-idiomatic way (`createShopify`, middleware, `getAdminClient`, etc.).

### Reuse as dependencies

```
@shopify/shopify-api
@shopify/shopify-app-session-storage   // + one concrete adapter
```

Specifically: `shopifyApi`, `auth.tokenExchange`, `auth.refreshToken`, `auth.getEmbeddedAppUrl`, `session.decodeSessionToken` / `getOfflineId` / `getJwtSessionId`, `webhooks.validate` / `addHandlers` / `register`, `billing.*`, `clients.Graphql` / `Storefront`, `utils.validateHmac` / `sanitizeShop`, `flow.validate`, `fulfillmentService.validate`, `Session`.

### Auth mode (this port)

- **In:** token exchange + managed installation (`/oauth/install` + session token → access token).
- **Out:** OAuth authorization-code `begin`/`callback`; merchant-custom static Admin token; non-embedded apps.

### SessionStorage

Treat `SessionStorage` as the only persistence API. Default to an existing adapter (Prisma/SQLite/memory) or a thin custom impl of the five methods. Session id convention must stay `offline_{shop}` / `{shop}_{userId}` so tokens remain compatible with Shopify's `createSession`.

### Nice-to-have glue (not blocking auth)

Billing `require`/`request` redirects, scopes `request` → install URL, app-proxy HMAC + `liquid` helper, Flow/POS/fulfillment authenticators, GraphQL `Response` wrapper for typed `admin.graphql()`.

### Not in this package

Customer Account GraphQL client; Polaris React components; App Bridge React bindings; REST Admin.

---

## Claim → source index

| Claim | Source |
|---|---|
| Exports map | `shopify-app-react-router/package.json` `exports` |
| `shopifyApp` wiring + token-exchange vs merchant-custom | `src/server/shopify-app.ts` |
| Config fields | `src/server/config-types.ts` |
| Return type | `src/server/types.ts` (`ShopifyApp`, `Authenticate`) |
| Admin pipeline | `src/server/authenticate/admin/authenticate.ts` |
| Token exchange strategy | `src/server/authenticate/admin/strategies/token-exchange.ts` |
| API token exchange POST | `shopify-api/lib/auth/oauth/token-exchange.ts` |
| JWT verify | `shopify-api/lib/session/decode-session-token.ts` |
| Session class | `shopify-api/lib/session/session.ts` |
| Session ids | `shopify-api/lib/session/session-utils.ts` |
| SessionStorage | `shopify-app-session-storage/src/types.ts` |
| Bounce | `authenticate/admin/helpers/redirect-to-bounce-page.ts` |
| Install URL | `authenticate/login/login.ts`, `admin/helpers/redirect-to-install-page.ts` |
| Webhooks | `authenticate/webhooks/authenticate.ts`, `register.ts`; `shopify-api/lib/webhooks/validate.ts` |
| Public / customer account | `authenticate/public/factory.ts`, `public/customer-account/*`, `public/extension/authenticate.ts` |
| Unauthenticated | `unauthenticated/admin/factory.ts`, `unauthenticated/storefront/factory.ts` |
| Clients | `clients/admin/*`, `clients/storefront/*` |
| Billing | `authenticate/admin/billing/*` |
| App Bridge / Polaris | `react/components/AppProvider/AppProvider.tsx`, `authenticate/const.ts` |
| Versions | each package's `package.json`; npm `2.0.0` / `14.0.0` / `6.0.0` |
