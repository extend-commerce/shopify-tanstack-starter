# Map of `@yan-ad/shopify-app-tanstack` (`authenticate.*` deep-dive)

**Ticket:** [ENG-2359](https://linear.app/extend-commerce/issue/ENG-2359) — research (AFK); blocks the API-ergonomics decision [ENG-2360](https://linear.app/extend-commerce/issue/ENG-2360). Parent map: [ENG-2320](https://linear.app/extend-commerce/issue/ENG-2320).
**Question:** From the actual source (not the docs site), establish `@yan-ad/shopify-app-tanstack`'s public surface, server boundary, isomorphic-exposure fit, session-token/bounce handling, typing, per-request cost, and migration cost — going deeper than [`rr-package-surface.md`](./rr-package-surface.md) on the `authenticate.*` methods.
**Date:** 2026-09-03

## Clones (primary source, not vendored)

| Repo | Ref | Path used |
|---|---|---|
| `Shopify/shopify-app-js` (sparse: `packages/apps/shopify-app-react-router`) | `main` @ `5b48bcb` | `…/scratchpad/shopify-app-js/packages/apps/shopify-app-react-router` |
| `yan-ad/shopify-app-tanstack` (= `yanuaraditia/shopify-app-tanstack`, redirect) | `main` @ `4f0d832` ("Merge #4 feat/nitro-tanstack-start-ssr"), npm `@yan-ad/shopify-app-tanstack@1.5.1` | `…/scratchpad/shopify-app-tanstack` |

A pre-existing `/private/tmp/shopify-app-js-research/shopify-app-js` was found but is a broken/partial checkout (only `session-storage/*`, empty `.git`) — not reused.

Paths below are given relative to each package's `src/` unless noted. `RR` = `@shopify/shopify-app-react-router`, `YA` = `@yan-ad/shopify-app-tanstack`.

---

## Summary

**YA is a hard fork of RR at `SHOPIFY_REACT_ROUTER_LIBRARY_VERSION = 1.2.0`** (current RR is `2.0.1`), not a from-scratch TanStack design. A file-for-file `diff -rq` of the two `src/` trees: **~115 files, all but ~35 byte-identical**, and of the 35 that differ, most differ only in JSDoc strings (`react-router` → `@tanstack/react-router`, `@shopify/shopify-app-react-router` → `@yan-ad/shopify-app-tanstack`). YA adds exactly two runtime files (`server/adapters/nitro/index.ts`, `server/helpers/redirect-response.ts`); RR has one YA drops (`shared/const.ts`).

- **Public surface (Q1):** `shopifyApp()` returns the **exact RR shape** — `authenticate.{admin,webhook,flow,pos,fulfillmentService,public.{checkout,appProxy,customerAccount}}`, `unauthenticated.{admin,storefront}`, `registerWebhooks`, `addDocumentResponseHeaders`, `sessionStorage`, `login`. Every one is a **real forked implementation**, not a stub or re-export. The only true re-exports are the `@shopify/shopify-api` value/type passthroughs in `server/index.ts` (identical list to RR). `boundary`/`AppProvider`/`AppProxyProvider`/`AppProxyLink` also present.
- **Server boundary (Q2/Q3):** YA never resolves the framework question. `authenticate.admin(request)` is a plain `(request: Request) => Promise<Context>` that **throws `Response`/`redirect()` as control flow** — identical to RR. YA's own doc examples still use `export const action = async ({request})` (un-migrated Remix idiom). The only migrated call site anywhere is the newer `docs/guide/nitro-tanstack-start-ssr.md`, which calls it inside a **server route** (`createServerFileRoute('/api/shop').methods({GET})`) — i.e. YA's intended boundary is a server route / server function, **not** an isomorphic `beforeLoad`/`loader`. Nothing keeps the access token off the client because YA assumes the app supplies a server and calls `authenticate.*` only there; it ships no dehydration story.
- **Isomorphic exposure (Q4):** As-is, YA does **not** survive Start's isomorphic `beforeLoad`/`loader` + dehydration boundary. `authenticate.admin` returns a live `admin` client (closure over `session.accessToken`) and (v1.2.0) a `redirect` fn — neither serialisable; a `throw redirect()` inside `authenticate.admin` is a thrown `Response`, which Start's isomorphic `beforeLoad` does not model the way RR's loader does. `boundary.error` still keys on `error.constructor.name === 'ErrorResponse' | 'ErrorResponseImpl'` (an RR-runtime type) so it silently never matches under TanStack.
- **Session token / bounce (Q5):** Handled **inside the package**, RR-verbatim. `authenticate.admin` reads the token from `Authorization: Bearer` or `?id_token=`, `api.session.decodeSessionToken` (HS256, `aud===apiKey`), `sessionStorage.loadSession`, token-exchange when missing/expired-within-5-min, `storeSession`, `afterAuth` once (60 s-TTL `IdempotentPromiseHandler`). Document request with no token → `renderAppBridge` throws HTML with the App Bridge `shopify-reload` script; non-embedded → redirect to `api.auth.getEmbeddedAppUrl`. YA's only structural change: `redirect` is imported from a 13-line local `helpers/redirect-response.ts` (builds a plain `Response` with `Location`) instead of `react-router`.
- **Typing (Q6):** YA ships **no ambient `.d.ts`**, **no `window.shopify` / App Bridge global typing**, **no route/loader context augmentation** (no `Register` interface, no `declare module`). `AppProvider` imports `useNavigate` from `@tanstack/react-router` and that is the *only* real framework import in runtime code. `boundary/types.ts` inlines its own `HeadersArgs` to drop the `react-router` type import.
- **Per-request cost (Q7):** `token-exchange.ts` is **byte-identical to RR**. Warm path (stored session present, `isActive` within 5-min buffer): **1 JWT verify (`jose`, in-proc) + 1 `sessionStorage.loadSession` read**, no Shopify network call, no store write. Cold/expiring path adds `POST /admin/oauth/access_token` + `storeSession` (+ `afterAuth` once). Same cost profile as this repo's `adminMiddleware`; the difference from this repo is the **global `requestMiddleware`**, which pays that JWT-verify + session read on *every* non-excluded SSR/server-route request (YA has no such global layer).
- **Migration cost (Q8):** For an RR-template author, adopting YA is a near drop-in (swap the import specifier, add a Nitro adapter import, `navigate({href})` shape, add `embedded` prop to `AppProvider`, hand-migrate `loader`/`action` exports to whatever TanStack call site they choose — YA gives no guidance). Adopting *this repo's* factory surface costs more concepts (register `requestMiddleware` in `start.ts`, attach `adminMiddleware` to every Admin `createServerFn`, move Admin calls out of loaders into server fns, drop the `.json()` unwrap, maintain an exclusion list) but the result actually fits Start's execution model.

**Bottom line for ENG-2360:** YA validates that the RR `authenticate.*` names and return shapes port verbatim and that consumers like them — but YA gets there by *not solving* the isomorphic-loader / dehydration / client-bundle problem that ADR 0003 is built around. A parity **facade** over this repo's existing engine is viable (the shapes are stable and well-understood); adopting YA's model wholesale is not.

---

## Q1 — Public surface: exact `shopifyApp()` return, real vs re-export

### Exports (`server/index.ts`, `react/index.ts`, `package.json#exports`)

`package.json` `exports`: `./server`, `./react`, `./test-helpers`, `./adapters/*` + `./server/adapters/*` (glob), and explicit `./adapters/nitro` + `./server/adapters/nitro`. ESM-only (`"type": "module"`, `.mjs`). Peer deps: `react`/`react-dom` `>=18`, **`@tanstack/react-router` `^1.169.2`** (no `@tanstack/react-start` / `@tanstack/start`). Runtime deps pin an **older base** than RR: `@shopify/shopify-api` `^13.0.0` (RR: 14), `@shopify/shopify-app-session-storage` `^5.0.0` (RR: 6), `@shopify/admin-api-client` `^1.1.2` (RR: 2).

`server/index.ts` vs RR — the **only** diff:

```diff
 import '@shopify/shopify-api/adapters/web-api';
-import {setAbstractRuntimeString} from '@shopify/shopify-api/runtime';
-
-setAbstractRuntimeString(() => {
-  return `React Router`;
-});
-
 export {
   LogSeverity, DeliveryMethod, BillingInterval,
   BillingReplacementBehavior, ApiVersion, Session,
 } from '@shopify/shopify-api';
```

(`setAbstractRuntimeString` moved into the adapters, mirroring RR's own Node adapter.) The re-export list — `LogSeverity`, `DeliveryMethod`, `BillingInterval`, `BillingReplacementBehavior`, `ApiVersion`, `Session`, type `JwtPayload` — is **identical to RR**. These are the *only* thin re-exports in the package.

### `shopifyApp(config)` return (`server/shopify-app.ts`, `server/types.ts`)

`server/types.ts` differs from RR **only in JSDoc** (`react-router` → `@tanstack/react-router`, package name). The `ShopifyApp` union (`AdminApp | AppStoreApp | SingleMerchantApp`) resolves to:

```ts
{
  sessionStorage,                       // the instance passed in
  addDocumentResponseHeaders,           // CSP frame-ancestors + Link preload
  registerWebhooks,                     // api.webhooks.register({ session })
  authenticate: {
    admin, flow, fulfillmentService, pos,
    public: { checkout, appProxy, customerAccount },
    webhook,
  },
  unauthenticated: { admin, storefront },
  login,                                // AppStore | SingleMerchant only (not ShopifyAdmin)
}
```

**Every method is a real forked implementation.** Verified byte-identical to RR (`diff -q`): `authenticate/public/factory.ts`, `authenticate/public/customer-account/authenticate.ts`, `authenticate/pos/authenticate.ts`, `unauthenticated/admin/factory.ts`, `unauthenticated/storefront/factory.ts` — YA did not even reformat them. `authenticate/admin/authenticate.ts`, `authenticate/webhooks/authenticate.ts`, `authenticate/flow/authenticate.ts`, `authenticate/fulfillment-service/authenticate.ts` differ only in logging lines + a v13-vs-v14 `check.valid === false` guard + one interface rename (`MerchantCustomAdminContext` → `NonEmbeddedAdminContext`).

`server/shopify-app.ts` diffs vs RR: package-name JSDoc; **removes the `isEmbeddedApp`-in-config `throw`** RR v2 added (v1.2.0 base predates it); `userAgentPrefix` → `` `TanStack Router Library v${SHOPIFY_REACT_ROUTER_LIBRARY_VERSION}` ``; drops `polarisUrl` handling (see Q6). Strategy selection unchanged: `distribution === ShopifyAdmin` → merchant-custom, else token-exchange.

### `boundary` / react components

- `server/boundary/{index,headers,error,types}.ts`: present. `headers.ts` inlines `HeadersArgs` from `./types` instead of `react-router`. `error.tsx` swaps JSX for `createElement` but **keeps the RR-runtime check** `error.constructor.name === 'ErrorResponse' || 'ErrorResponseImpl'` — dead under TanStack.
- `react/`: `AppProvider`, `AppProxyProvider`, `AppProxyLink` — all real (forked). `AppProvider` re-adds an `embedded` boolean prop (RR v2 dropped non-embedded), injects App Bridge only when `embedded`, hardcodes `polaris.js` URL, adds a `routerDevtools` slot, and calls `navigate({href})` (RR: `navigate(href)`).

---

## Q2 — Server boundary: where does `authenticate.admin(request)` actually run?

**YA does not decide this.** `authenticate.admin` is typed (`server/authenticate/admin/types.ts`) as:

```ts
export type AuthenticateAdmin<Config extends AppConfigArg> = (
  request: Request,
) => Promise<AdminContext<Config>>;
```

a bare `Request → Promise<Context>` with `throw Response | redirect()` control flow (`server/authenticate/admin/authenticate.ts`, unchanged pipeline from RR). It has no knowledge of routers, loaders, middleware, or server functions.

**Evidence of intended call site:**

1. **YA's own doc examples are un-migrated Remix.** `server/authenticate/admin/authenticate.admin.doc.example.ts`:

```ts
import {authenticate} from '../shopify.server';
type ActionFunctionArgs = {request: Request};
export const action = async ({request}: ActionFunctionArgs) => {
  const {admin, redirect} = await authenticate.admin(request);
  await admin.graphql(`#graphql mutation … { … }`, { variables: { … } });
  return redirect('/app/product-updated');
};
```

Same pattern in `authenticate.webhooks.doc.example.ts`, `authenticate.flow.doc.example.ts`, etc. — `export const action = async ({request})`, a locally re-declared `ActionFunctionArgs`, no `createServerFn` / `createServerFileRoute`.

2. **The only migrated example** is `docs/guide/nitro-tanstack-start-ssr.md` — a **server route**:

```ts
import {createServerFileRoute} from '@tanstack/react-start/server';
import {authenticate} from '~/shopify.server';

export const ServerRoute = createServerFileRoute('/api/shop').methods({
  GET: async ({request}) => {
    const {admin} = await authenticate.admin(request);
    const response = await admin.graphql(`{ shop { name } }`);
    return Response.json(await response.json());
  },
});
```

3. **`docs/guide/authentication-flows.md`** "Practical guidance": *"Put auth checks in each server loader/endpoint. Keep mutation endpoints authenticated independently of page loaders."* — i.e. call it yourself, per route, wherever your server code runs.

**Access-token exposure:** a non-issue *by assumption*, not by design. YA targets TanStack **Router** (peer dep `@tanstack/react-router` only); in a plain Router SPA the app brings its own server (Nitro/Express) and `authenticate.admin` is expected to run only in that server's route handlers. The token lives on the `Session` inside the returned `admin` client's closure; YA never puts it on a router-context or loader return because YA never wires a router context at all. There is no `handler.fetch({ context })`, no `createRootRouteWithContext`, no dehydration in the package.

---

## Q3 — Isomorphic exposure: what survives Start's `beforeLoad`/`loader` + dehydration?

ADR 0003's constraint: loaders and `beforeLoad` are isomorphic and their return values are dehydrated to the client, so an access token or live client cannot live there.

| YA artefact | Survives isomorphic loader/beforeLoad + dehydration? |
|---|---|
| `authenticate.admin(request)` **called from a server route / server fn** | Yes — same as this repo's `adminMiddleware`. Not isomorphic, runs server-only. |
| `authenticate.admin(request)` **called from an isomorphic `beforeLoad`/`loader`** (the RR-porter's instinct) | **No.** Returns `{ admin, session, sessionToken, billing, cors, redirect, scopes }`. `admin`/`cors`/`redirect`/`billing`/`scopes` are functions (closures over `session` + `api`) — not serialisable, so they cannot cross the dehydration boundary; `session` carries `accessToken` and must not. |
| `throw redirect()` / `throw renderAppBridge()` inside `authenticate.admin` | Partially. YA's `redirect()` (`helpers/redirect-response.ts`) is a real `Response`; TanStack Start can throw `Response` from a server route, but an **isomorphic** `beforeLoad` models redirects via `throw redirect({to})` (router object), not a thrown `Response` with `Location`. The bounce HTML path (`renderAppBridge` → `throw new Response(html, {headers})`) has no isomorphic equivalent — it must be a server route. |
| `boundary.error(error)` | **No.** Keys on `error.constructor.name === 'ErrorResponse' | 'ErrorResponseImpl'` (`server/boundary/error.tsx`) — those classes are React Router internals. Under TanStack the branch is unreachable and `boundary.error` just re-`throw`s. |
| `AppProvider` (`react/`) | Yes — pure client component; `useNavigate` from `@tanstack/react-router` works in Router and Start. |
| `unauthenticated.admin(shop)` / `.storefront(shop)` | Yes if called server-side; same non-serialisable-client caveat if a return value is dehydrated. |

Net: YA's server helpers are fine **as server-route/server-fn bodies** and useless **as isomorphic-loader bodies** — which is exactly the split this repo's ADR 0001/0003 already forces via `adminMiddleware` + server functions. YA provides none of the plumbing to keep a porter on the safe side of that line.

---

## Q4 — (folded into Q3 above)

The distinct point: YA's package has **zero Start-specific code** other than the additive `server/adapters/nitro/index.ts` (7 lines: `setAbstractRuntimeString(() => 'TanStack Start (Nitro)')` + `APP_BRIDGE_URL` override) and the `nitro-tanstack-start-ssr.md` guide (added `v1.5.0`, 2 commits before HEAD). The Nitro adapter changes only the runtime string; it does **not** add dehydration, router context, `createServerFn` integration, or a client-safe context subset. Everything in Q3's "No" rows is unaddressed.

---

## Q5 — Session token / `id_token` → Bearer → refresh cycle, and the bounce

**All inside the package, RR-verbatim.** `authenticate/admin/authenticate.ts` (`authStrategyFactory`) — the pipeline (unchanged from RR bar logging):

1. `respondToBotRequest` (isbot; allow Shopify POS/Mobile) → 410
2. `respondToOptionsRequest` → 204 + CORS
3. path ends `patchSessionTokenPath` → `redirectToBouncePage` (throws)
4. path ends `exitIframePath` → `renderAppBridge` with `window.open` (throws)
5. no `Authorization: Bearer` (document request): `validateShopAndHostParams` → if `embedded !== '1'` redirect to `api.auth.getEmbeddedAppUrl`; else if no `?id_token` → `redirectToBouncePage`
6. token from `Authorization: Bearer` **or** `?id_token=` (`helpers/get-session-token-header.ts`, identical)
7. `validateSessionToken` → `api.session.decodeSessionToken(token, { checkAudience })` (HS256 HMAC of `apiSecretKey`, 10 s clock tolerance, `aud === apiKey`)
8. `sessionId = useOnlineTokens ? api.session.getJwtSessionId(shop, sub) : api.session.getOfflineId(shop)`
9. `config.sessionStorage.loadSession(sessionId)`
10. strategy `authenticate(request, { session, sessionToken, shop })`

Token-exchange strategy (`authenticate/admin/strategies/token-exchange.ts` — **byte-identical to RR**):

```ts
if (!session || !session.isActive(undefined, WITHIN_MILLISECONDS_OF_EXPIRY)) {
  const {session: offlineSession} = await exchangeToken({
    request, sessionToken, shop,
    requestedTokenType: RequestedTokenType.OfflineAccessToken,
  });
  await config.sessionStorage!.storeSession(offlineSession);
  let newSession = offlineSession;
  if (config.useOnlineTokens) { /* second exchange, store, newSession = onlineSession */ }
  try { await handleAfterAuthHook(newSession, request, sessionToken); }
  catch (errorOrResponse) { if (errorOrResponse instanceof Response) throw errorOrResponse; throw new Response(undefined, {/* 500 */}); }
}
```

`WITHIN_MILLISECONDS_OF_EXPIRY = 5 * 60 * 1000`. `afterAuth` idempotency = `IdempotentPromiseHandler`, 60 s TTL. Invalid JWT / Shopify `400 invalid_subject_token` → `respondToInvalidSessionToken`: document → bounce; XHR → **401** + `X-Shopify-Retry-Invalid-Session-Request: 1`. GraphQL **401** → `invalidateAccessToken` (clear `session.accessToken`, `storeSession`) then same invalid-token response.

**Bounce HTML** (`helpers/render-app-bridge.ts`): `throw new Response(html, { headers: { 'content-type': 'text/html;…' } })` where `html` embeds `<script data-api-key … src="https://cdn.shopify.com/shopifycloud/app-bridge.js">`; App Bridge reads the `shopify-reload` header/param and reloads. YA diff here: drops `api.utils.sanitizeShop()` on the `?shop` param before it reaches `addDocumentResponseHeaders` (a v1.2.0-vintage gap; RR v2 sanitizes) and drops the `polarisUrl` arg.

**The one structural change:** RR imports `redirect` from `react-router`; YA replaces every such import with `helpers/redirect-response.ts`:

```ts
export function redirect(url: string, init: RedirectInit = 302): Response {
  const responseInit = typeof init === 'number' ? {status: init} : init;
  const headers = new Headers(responseInit.headers);
  headers.set('Location', url);
  return new Response(null, {...responseInit, headers, status: responseInit.status ?? 302});
}
```

Since RR's `redirect()` also just returns a `Response`, this is a like-for-like shim. Touched files: `redirect-to-bounce-page.ts`, `redirect-to-install-page.ts`, `redirect-to-shopify-or-app-root.ts`, `redirect.ts`, `billing/helpers.ts`, `login/login.ts`.

The embedded `id_token` → `Bearer` refresh loop on the **client** (App Bridge's `fetch` interceptor adding `Authorization: Bearer`) is App Bridge's job, not the package's — same as RR. YA ships nothing for it.

---

## Q6 — Typing: `window.shopify`, ambient `.d.ts`, context augmentation

- **No ambient `.d.ts` anywhere.** `find … -name '*.d.ts'` → only `src/__tests__/vitest-jest-compat.d.ts` (a Jest-compat test shim). No `shopify-elements.d.ts`, no App Bridge global shim.
- **No `window.shopify` / App Bridge global typing.** `grep -rn 'declare global|window.shopify|declare module|app-bridge-types|@shopify/app-bridge'` over `src/` → zero runtime hits. YA does not depend on `@shopify/app-bridge-types` (this repo's prototype does, for the `React.JSX` shim).
- **No route/loader context augmentation.** No `Register` interface, no `declare module '@tanstack/react-router'`, no module augmentation. YA has no router-context concept to augment.
- **Only real framework import in runtime code:** `import {useNavigate} from '@tanstack/react-router'` in `react/components/AppProvider/AppProvider.tsx`. `boundary/types.ts` *removes* its `react-router` type import by inlining `interface HeadersArgs { parentHeaders?, loaderHeaders?, actionHeaders?, errorHeaders?: Headers }`.
- Server context typing is purely structural: `AdminContext<Config>` etc. in `server/authenticate/**/types.ts`, resolved by the `Config['distribution']` generic — identical to RR, no augmentation hook for the consumer.

Runtime `src/` is otherwise runtime-agnostic (no `node:*` imports; only `process.env.PORT` in `deriveApi` guarded by `no-process-env` eslint pragmas, and `process.env.APP_BRIDGE_URL` in the adapters) — same posture as RR.

---

## Q7 — Per-request cost of `authenticate.admin` on a warm path

`strategies/token-exchange.ts` is **byte-identical to RR**, so the cost model in `rr-package-surface.md` §4 applies exactly.

| Path | Work |
|---|---|
| **Warm** (stored `Session` present, `session.isActive(undefined, 5*60*1000)` true) | `authenticate.ts`: 1× `api.session.decodeSessionToken` — `jose.jwtVerify` HS256 against `hmac(apiSecretKey)`, **in-process, no I/O**. + 1× `sessionStorage.loadSession(id)` — one session-store read. Strategy then returns the existing `session`. **No Shopify network call, no `storeSession` write, no `afterAuth`.** |
| **Cold / within 5-min expiry buffer / no stored session** | Above + `POST https://{shop}/admin/oauth/access_token` (token exchange) + `sessionStorage.storeSession` + (`useOnlineTokens` → second exchange + store) + `afterAuth` once per session-token (60 s-TTL de-dupe). |
| **Invalid/expired JWT** | `decodeSessionToken` throws → bounce (document) or 401 + retry header (XHR). No store read. |
| Bot / OPTIONS / bounce-path / exit-iframe-path | Short-circuits before any I/O. |

**Vs. this repo's boundary:** this repo's `adminMiddleware` (`packages/shopify-app-tanstack-start/src/server/auth/admin-middleware.ts`) does the same warm-path work per Admin `createServerFn` call. The material difference is this repo's **global `requestMiddleware`** (`…/auth/request-middleware.ts`), which runs on *every* non-excluded SSR render and server-route request:

```ts
const token = getSessionTokenFromRequest(request, url);
if (!token) return next({ context: { shopify: { ...EMPTY } } });
const decoded = await api.session.decodeSessionToken(token);      // JWT verify, every SSR
const session = await ensureAuthenticatedOfflineSession(internals, {…}); // loadSession read, every SSR
```

So this repo pays `1 JWT verify + 1 session read` on the warm path of every SSR page render (plus the same again in `adminMiddleware` when the page's server fns run); YA — having no global layer — pays it only where the app explicitly calls `authenticate.admin`. That is the concrete cost of ADR 0002's single-choke-point guarantee, and a data point ENG-2360's "drop the global two-layer boundary" sub-question should weigh.

---

## Q8 — Migration cost

### RR-template author → adopt `@yan-ad/shopify-app-tanstack`

Near drop-in, because it *is* RR v1.2.0:

1. Dependency swap: `@shopify/shopify-app-react-router` → `@yan-ad/shopify-app-tanstack`; add `@tanstack/react-router`; (Start) add `nitro` + `import '@yan-ad/shopify-app-tanstack/server/adapters/nitro'` at the top of `shopify.server.ts`.
2. `shopifyApp(config)` call unchanged except **remove `polarisUrl`** from config and from `<AppProvider>`; add `embedded` to `<AppProvider embedded apiKey={…}>`.
3. `import {useNavigate}`… is internal; but the `shopify:navigate` handler now calls `navigate({href})` — fine, internal.
4. **Hand-migrate every route.** YA gives no codemod and no guidance beyond "put auth checks in each server loader/endpoint." Each `export async function loader({request})` / `export const action` must become whatever TanStack call site the author picks (`createServerFileRoute(...).methods(...)`, `createServerFn().handler(...)`, a Router `loader`). YA's own doc examples are still `export const action` — so the author is copying an un-migrated pattern.
5. Accept the un-addressed gaps: `boundary.error` is dead; `authenticate.admin` in an isomorphic loader leaks a non-serialisable client / token; base is RR **1.2.0** (missing 1.3→2.0.1 fixes incl. the `?shop` sanitisation in `render-app-bridge`, `expiringOfflineAccessTokens`, the `isEmbeddedApp` guard).
6. If on RR v2 already: also a **downgrade** — re-introduce non-embedded `AppProvider` prop, lose v2 changes.

### RR-template author → adopt this repo's current factory surface

More to learn, but lands on something that fits Start:

1. `shopifyApp(config)` → `createShopifyApp(config)`; same config field *names* (ADR 0001), minus legacy-OAuth + `restResources`.
2. Register the global `requestMiddleware` in `src/start.ts` via `createStart` (new concept).
3. Attach `adminMiddleware` to **every** `createServerFn` that touches Admin; move all Admin GraphQL out of loaders/components into those server fns; loaders call the server fns (ADR 0003).
4. Drop the `.json()` unwrap — `admin.graphql()` here resolves **parsed `{data,errors,extensions}`**, not a `Response` (ADR 0003). No `.status`/`.headers` on the result.
5. Webhooks: `shopify.handlers.webhooks(...)` mounted as server routes; subscriptions declared in `shopify.app.toml` only (no `webhooks` config map, no `afterAuth` register) (ADR 0004).
6. Bounce: rely on the pathless `_authenticated` `beforeLoad` + `/auth/$` splat (ADR 0002/0006) instead of RR's "bounce rendered inside `authenticate.admin`".
7. Maintain the `requestMiddleware` path-exclusion list (`apps/web/app/shopify.exclude-paths.ts`) — load-bearing.
8. Live with the current wart ENG-2360 targets: `apps/web/app/shopify.middleware.ts` is a hand-written husk with `as never` casts and inline `await import('~/shopify.server')` to keep the server-only instance out of the client bundle while still exporting `requestMiddleware` / `adminMiddleware` handles for `start.ts` and server-fn files.

**Trade:** YA minimises *switching* cost by copying RR's surface and punting on the framework mismatch; this repo pays switching cost up front to keep the token off the client and match Start's data boundary. ENG-2360's middle path — keep this repo's engine, add a thin `authenticate.*`-named facade + ship the ambient types + fold the bounce guard into the package — captures YA's familiarity win without inheriting its unsolved problems.

---

## Appendix: file-tree delta (`diff -rq`, tests excluded)

**Only in YA:** `server/adapters/nitro/index.ts`, `server/helpers/redirect-response.ts`.
**Only in RR:** `shared/const.ts` (YA moves `APP_BRIDGE_URL` to `react/const.ts`, inlines `POLARIS_URL` at use sites).
**Differ (non-JSDoc-only):** `server/index.ts` (drop `setAbstractRuntimeString`), `server/shopify-app.ts` (drop `isEmbeddedApp` throw + `polarisUrl` + UA string), `server/config-types.ts` (drop `polarisUrl`, inline the `Omit<ApiConfigArg…>`), `server/version.ts` (`1.2.0` vs `2.0.1`), `server/boundary/{headers,types,error}.ts` (inline `HeadersArgs`, `createElement`), `authenticate/admin/authenticate.ts` + `strategies/types.ts` (`MerchantCustomAdminContext`→`NonEmbeddedAdminContext`), `authenticate/admin/helpers/{redirect*,render-app-bridge,billing/helpers}.ts` (local `redirect` import, drop `polarisUrl`/`sanitizeShop`), `authenticate/helpers/{add-response-headers,validate-session-token}.ts` (drop `polarisUrl`, trim logging), `authenticate/webhooks/authenticate.ts` + `flow/authenticate.ts` (`check.valid === false`, extra event fields from shopify-api v13), `react/components/AppProvider/AppProvider.tsx` (`@tanstack/react-router`, `embedded` prop, devtools slot), `react/components/AppProxy*.tsx` (JSDoc).
**All ~80 other files:** byte-identical to RR v1.2.0.

## Claim → source index

| Claim | Source |
|---|---|
| YA = RR fork @ 1.2.0 | `YA server/version.ts`; `diff -rq` of the two `src/` trees |
| Exports / peers / older base deps | `YA package.json` |
| `shopifyApp()` return shape | `YA server/types.ts`, `server/shopify-app.ts` (both ≈ RR) |
| Methods are real, not stubs | `diff -q` byte-identical: `YA authenticate/public/factory.ts`, `public/customer-account/authenticate.ts`, `pos/authenticate.ts`, `unauthenticated/*/factory.ts`, `clients/admin/graphql.ts` |
| Intended call site = server route / server fn | `YA docs/guide/nitro-tanstack-start-ssr.md`; `docs/guide/authentication-flows.md` |
| Doc examples un-migrated | `YA server/authenticate/**/**.doc.example.ts` |
| Admin pipeline / token-exchange / bounce | `YA server/authenticate/admin/authenticate.ts`, `strategies/token-exchange.ts` (identical to RR), `helpers/render-app-bridge.ts`, `helpers/redirect-to-bounce-page.ts` |
| `redirect` shim | `YA server/helpers/redirect-response.ts` |
| `boundary.error` dead branch | `YA server/boundary/error.tsx` |
| No ambient types / no augmentation | `find … -name '*.d.ts'`; `grep -rn 'declare global|window.shopify|Register|declare module'` over `YA src/` |
| Warm-path cost | `YA strategies/token-exchange.ts` = RR; `rr-package-surface.md` §4 |
| This repo's global middleware cost | `packages/shopify-app-tanstack-start/src/server/auth/request-middleware.ts` |
| The husk ENG-2360 targets | `apps/web/app/shopify.middleware.ts` |
| This repo's current surface | `packages/shopify-app-tanstack-start/src/server/{index,shopify-app}.ts`; ADRs 0001–0004 |
