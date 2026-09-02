# TanStack Start server & routing model

**Ticket:** [ENG-2321](https://linear.app/extend-commerce/issue/ENG-2321/map-the-tanstack-start-server-and-routing-model)
**Question:** What is the current, factual picture of TanStack Start that a Shopify app package port depends on?
**Date:** 2026-08-28
**Sources:** official Start/Router docs (`tanstack.com/start/latest`, `tanstack.com/router/latest`), npm registry snapshots the same day, GitHub source in `TanStack/router` (`packages/start-server-core`, `packages/react-start-server`, `packages/router-core`). Nitro facts from `nitro.build` and the `nitro` npm package. Not vendored.

---

## Recommendation (target line)

Pin **`@tanstack/react-start@1.168.49`** (published 2026-08-22) with its bundled **`@tanstack/react-router@1.170.32`**. Docs still call Start a **Release Candidate** (feature-complete, API considered stable, not yet “v1”). Do **not** treat Nitro as the framework runtime: Start’s contract is a WinterCG `fetch(Request) → Response` handler; Vite (peer `>=7`) or Rsbuild is the bundler; Nitro is an **optional** Vite plugin for Node/Vercel/Bun/AWS/etc. Cloudflare and Netlify have first-party Vite plugins that skip Nitro.

Auth wiring for the port: **request middleware is the data boundary**; **`beforeLoad` is route UX only**; **webhooks and OAuth/callback URLs are server routes**; **App Bridge + `shopify-api-key` go on `routeOptions.head`**, rendered by `<HeadContent />`.

---

## Versions and stability

| Package | Latest (`latest` tag, 2026-08-28) | Notes |
|---|---|---|
| `@tanstack/react-start` | **1.168.49** | Updated 2026-08-22. Peers: `react`/`react-dom` `>=18 \|\| >=19`, `vite` `>=7.0.0`, optional `@rsbuild/core` `^2`. Depends on `@tanstack/react-router@1.170.32`, `@tanstack/start-server-core@1.169.31`. |
| `@tanstack/react-router` | **1.170.32** | `engines.node`: `>=20.19`. |
| `nitro` (optional deploy plugin) | **`3.0.260610-beta`** | npm README: this is the **v3 branch**; “current stable release” is Nitro v2. Start’s hosting docs import `nitro/vite` (v3 API) and warn the plugin is under active development. |

**Stability (official):** “TanStack Start is currently in the Release Candidate stage! This means it is considered feature-complete and its API is considered stable.” Road to v1 described as “likely a quick one.” Comparison page: Next.js / React Router v7 are “production-ready”; Start is “Release Candidate … rapidly stabilizing toward v1.” npm already publishes `1.x` versions — the 1.x number is **not** a declared v1 product status.

Sources:

- https://tanstack.com/start/latest/docs/framework/react/overview — “Release Candidate”
- https://tanstack.com/start/latest/docs/framework/react/comparison — “Release Candidate stage”
- https://registry.npmjs.org/@tanstack/react-start/latest — version, peers, deps
- https://registry.npmjs.org/@tanstack/react-router/latest — version, engines
- https://registry.npmjs.org/nitro/latest — `3.0.260610-beta`, v3-vs-v2 note

**Port implication:** target the current `1.168.x` line, expect patch churn, do not wait for a marketing “v1”. Keep `vite` on 7+.

---

## Server runtime: Vite + fetch, Nitro optional

Start is “powered by TanStack Router” plus “Vite or Rsbuild.” The application contract is the **route tree**; the server layer is a **universal fetch handler** (WinterCG / Cloudflare Workers shape), not a Node `http.IncomingMessage` API.

Default server entry (`src/server.ts` is optional; Start supplies this if omitted):

```ts
import handler, { createServerEntry } from '@tanstack/react-start/server-entry'

export default createServerEntry({
  fetch(request) {
    return handler.fetch(request)
  },
})
```

`createStartHandler` (used by that default entry) runs **three phases** in order:

1. **Server function dispatch** — if the URL pathname starts with `TSS_SERVER_FN_BASE` (docs/skill: `/_serverFn`).
2. **Server route handlers** — exact match on `createFileRoute(…).server.handlers`.
3. **App SSR** — `router.load()`, dehydrate, then `defaultStreamHandler` → `renderRouterToStream`.

Sources:

- https://tanstack.com/start/latest/docs/framework/react/overview — Vite or Rsbuild; “Universal Deployment”
- https://tanstack.com/start/latest/docs/framework/react/guide/server-entry-point — `ServerEntry.fetch`, optional `src/server.ts`
- `TanStack/router` `packages/start-server-core/src/createStartHandler.ts` — `SERVER_FN_BASE`, `handleServerRoutes`, `executeRouter`
- `TanStack/router` `packages/react-start-server/src/defaultStreamHandler.tsx` — `defaultStreamHandler` → `renderRouterToStream`
- `TanStack/router` `packages/react-start/src/default-entry/server.ts` — default `createStartHandler(defaultStreamHandler)`

### Hosting adapters (Node vs edge/Workers)

Official Start hosting list: `cloudflare-workers`, `netlify`, `railway`, `nitro`, `vercel`, `node-server`, `bun`, `appwrite-sites`.

| Target | How Start says to deploy | Runtime class |
|---|---|---|
| **Node.js / Docker** | Vite: add `nitro()` plugin; `start` = `node .output/server/index.mjs`. Rsbuild: `dist/server` exports `{ fetch(request) }` — wrap with `srvx` or Express. | **Node** |
| **Railway** | “Follow the Nitro deployment instructions” | **Node** (Nitro default) |
| **Vercel** | Follow Nitro instructions | Nitro auto-detects Vercel (platform-specific output; not a generic Node listener) |
| **Bun** | `nitro({ preset: 'bun' })`, or a custom Bun `server.ts` | **Bun** (Node-like, not Workers) |
| **Cloudflare Workers** | **`@cloudflare/vite-plugin`**, `wrangler.jsonc` with `"main": "@tanstack/react-start/server-entry"`, `compatibility_flags: ["nodejs_compat"]`. **Not Nitro.** | **Workers / edge** |
| **Netlify** | **`@netlify/vite-plugin-tanstack-start`**. **Not Nitro.** | Netlify functions (platform plugin) |
| **Appwrite Sites** | Framework detect; output `./dist` (Nitro v2/v3: `./.output`) | Platform |

Nitro (when you opt in) is “an agnostic layer” with `nitro/vite`. Default production preset is **Node.js server**. Start example: `nitro({ preset: 'bun' })`. Nitro’s own docs:

| Nitro preset | Class |
|---|---|
| `node_server` (default), `node_cluster`, `node_middleware` | **Node** |
| `bun` | **Bun** |
| `cloudflare_module` (recommended), `cloudflare_pages` | **Workers / edge** |
| `aws_lambda` (optional `awsLambda.streaming`) | **Lambda** (Node-on-Lambda; streaming optional) |
| Auto-detect CI: aws amplify, azure, cloudflare, firebase app hosting, netlify, stormkit, vercel, zeabur | Platform-specific |

**GCP:** neither Start hosting nor Nitro documents a Cloud Run / GCE preset. Cloud Run is a container that runs the Node listener → use **`node_server`**. AWS can be Lambda (`aws_lambda`) **or** Node on ECS/EC2 (`node_server`).

Sources:

- https://tanstack.com/start/latest/docs/framework/react/guide/hosting
- https://nitro.build/deploy — default Node; auto-detect list; `NITRO_PRESET`
- https://nitro.build/deploy/runtimes/node — `node_server` / `node_cluster` / `node_middleware`
- https://nitro.build/deploy/providers/cloudflare — `cloudflare_module`
- https://nitro.build/deploy/providers/aws — `aws_lambda`
- https://nitro.build/deploy/runtimes/bun — `bun`

**Port implication:** assume Node now (`nitro()` + `node_server`, or Rsbuild + `srvx`). Keep the **fetch handler** as the seam so Cloudflare (`@cloudflare/vite-plugin`) and AWS Lambda (`aws_lambda`) are later preset/plugin swaps, not an app rewrite. Do not bake Nitro APIs into `packages/shopify-app-tanstack-start`.

---

## Raw `Request` / `Response`

### Anywhere in the server call stack (ALS)

Import from **`@tanstack/react-start/server`** (server-only; throws outside a request):

| Symbol | Role |
|---|---|
| `getRequest()` | Full Web **`Request`** (`event.req` on the current h3 event) |
| `getRequestHeader(name)` / `getRequestHeaders()` | Headers |
| `getRequestIP` / `getRequestHost` / `getRequestUrl` / `getRequestProtocol` | Derived request metadata (forwarded-header opts) |
| `setResponseHeader` / `setResponseHeaders` / `setResponseStatus` | Mutate the in-flight response |
| `getCookie` / `setCookie` / `deleteCookie` / `getCookies` | Cookies |
| `useSession` / `getSession` / `updateSession` / `clearSession` | Signed cookie sessions (h3 session helpers) |

Implementation: `AsyncLocalStorage` keyed `Symbol.for('tanstack-start:event-storage')`, wrapping an **h3 v2** `H3Event`. `getRequest()` returns `getH3Event().req`. Calling these outside `requestHandler` throws: `No StartEvent found in AsyncLocalStorage`.

Source: `TanStack/router` `packages/start-server-core/src/request-response.ts` — `getRequest`, `requestHandler`, `setCookie`, `useSession`.
Docs: https://tanstack.com/start/latest/docs/framework/react/guide/server-functions — “Server Context & Request Handling”.

### Server route handlers

Each method handler receives `{ request, params, context }` and **returns a Web `Response`** (or `Response.json(...)`). `request` is the incoming `Request`. Handlers may also use the ALS helpers above.

Source: https://tanstack.com/start/latest/docs/framework/react/guide/server-routes — “Handler Context”.

### Server functions

May **return a `Response`** (allowed even in `strict` serialization mode) or a serializable value. May also mutate headers/status via the ALS setters. Abort: `getRequest().signal`.

Source: https://tanstack.com/start/latest/docs/framework/react/guide/server-functions — serialization; “Raw Responses”; `getRequest()`.

**Port implication:** Shopify HMAC, session cookies, and token-exchange all sit on the Web `Request`/`Response` surface. Do not take a Node `IncomingMessage` dependency.

---

## Server routes vs `createServerFn`

Official split:

> Server functions are meant to be called by your TanStack Start application. … If you need an endpoint that can be called from **outside** your Start app, use **server routes** instead.

> Server functions are **same-origin RPC** endpoints. Browser requests should come from the same origin (Fetch Metadata / `Origin` / `Referer`). Use server routes for public APIs or **intentionally cross-origin** endpoints.

| | **Server functions (`createServerFn`)** | **Server routes (`createFileRoute` + `server.handlers`)** |
|---|---|---|
| Caller | App code (loaders, components via `useServerFn`, other server fns) | Anything with HTTP: Shopify, browsers, other origins |
| Transport | Compiled RPC; client stub `fetch`es `TSS_SERVER_FN_BASE` (`/_serverFn/…`); header `x-tsr-serverFn: true` on those requests | Exact URL from the file route (`/webhooks`, `/auth/callback`, …) |
| Serialization | Start handles it; `strict` checks input/output serializability; `FormData` + `Response` allowed | You own body parse (`request.json()` / `.text()` / `.arrayBuffer()`) and `Response` |
| CSRF | `createCsrfMiddleware` **auto-installed** if there is **no** `src/start.ts`. If you define `src/start.ts`, you **must** add it (or disable the warning). Filter with `ctx.handlerType === 'serverFn'`. | Not CSRF-protected unless you attach middleware. Correct for Shopify webhooks. |
| Methods | `GET` (default) or `POST` | `GET`/`POST`/`PUT`/`PATCH`/`DELETE`/`HEAD`/`ANY`. HEAD falls back to GET then ANY (RFC 9110). |
| Auth | Attach `.middleware([authMiddleware])` on **each** protected fn. Reachable without going through a route. | `server.middleware` and/or per-method middleware via `createHandlers` |
| When to use | Token-exchange helpers, Admin GraphQL, session reads used by the Polaris UI | **Webhooks**, OAuth/managed-install **callbacks**, GDPR endpoints, any HMAC/raw-body URL Shopify POSTs |

File conventions for server routes match Router: `routes/users/$id.ts` → `/users/$id`; splat `routes/api/file/$.ts` with `params._splat`; escaped `routes/users[.]json.ts` → `/users.json`. Pathless layouts can wrap a group of server routes with middleware.

Sources:

- https://tanstack.com/start/latest/docs/framework/react/guide/server-functions
- https://tanstack.com/start/latest/docs/framework/react/guide/server-routes
- `createStartHandler.ts` — `SERVER_FN_BASE`, `x-tsr-serverFn`, HEAD fallback

**Port implication:** do **not** implement Shopify webhooks as `createServerFn`. They are outside callers with HMAC bodies. Do **not** apply global CSRF to those routes.

---

## Router `context`, `beforeLoad`, middleware

There are **three context channels**. Mixing them is the main footgun.

### 1. Router context (isomorphic, typed)

- Type the root with `createRootRouteWithContext<MyRouterContext>()`.
- Seed with `createRouter({ context: { … } })` in `src/router.tsx` (`getRouter()` must return a **new** instance each call).
- `beforeLoad` **return value is merged into** route context and is available to child `loader`s / `useRouteContext()`.
- `beforeLoad` / `loader` **run on the server during the initial SSR request and again on the client during client navigations** (isomorphic). They are **not** server-only.
- Putting secrets in `beforeLoad`’s return **sends them to the client** (`ssr: true` “send[s] the resulting context to the client”).

Sources:

- https://tanstack.com/router/latest/docs/framework/react/guide/router-context
- https://tanstack.com/router/latest/docs/framework/react/guide/authenticated-routes — `beforeLoad` is “essentially a middleware function for the route and all of its children”; **“A route guard is not a data authorization boundary.”**
- https://tanstack.com/router/latest/docs/framework/react/api/router/RouteOptionsType — `beforeLoad` / `loader` signatures
- https://tanstack.com/start/latest/docs/framework/react/guide/routing — `getRouter()`
- https://tanstack.com/start/latest/docs/framework/react/guide/execution-model — loaders are isomorphic; secrets belong in `createServerFn` / `.server.ts`
- https://tanstack.com/start/latest/docs/framework/react/guide/selective-ssr — `ssr: true` runs `beforeLoad`+`loader` on the server and **sends context + loader data to the client**

### 2. Start request middleware context (server-only unless `sendContext`)

`createMiddleware()` (type `'request'` default): `.server(({ next, context, request }) => next({ context: { session } }))`.

- **Request middleware** runs for **server routes, SSR, and server functions**.
- **Function middleware** (`createMiddleware({ type: 'function' })`) adds `.client()`, `.validator()`, and can `sendContext` across the RPC boundary (must validate; never send the session from the client).
- Global: `src/start.ts` + `createStart(() => ({ requestMiddleware, functionMiddleware }))`. **Not in the default template.** Defining this file **disables auto CSRF** — add `createCsrfMiddleware({ filter: (ctx) => ctx.handlerType === 'serverFn' })` yourself.
- Middleware `request` is the Web `Request`. Same ALS helpers as server functions.

How this reaches the router on SSR (`createStartHandler.ts`):

```ts
routerInstance.options.additionalContext = { serverContext }
await routerInstance.load()
```

`serverContext` here is the **accumulated middleware context** (fetch `context` + `next({ context })` merges).

How the router consumes it (`@tanstack/router-core@1.171.27` `src/load-server.ts`): **`additionalContext` is spread onto the `beforeLoad` / `loader` options object**, not into `context`:

```ts
const options = {
  search, abortController, params, preload, context, location, /* … */
  ...router.options.additionalContext, // → { serverContext }
}
await route.options.beforeLoad(options)
```

So during **SSR** you read Start’s per-request bag as **`serverContext` on the beforeLoad/loader args** (`({ context, serverContext }) => …`), **not** as `context.session`. On **client navigations** `additionalContext` is unset (`getRouter()` builds a fresh router). Do not rely on `serverContext` after hydration.

`handler.fetch(request, { context })` (typed via `declare module '@tanstack/react-router' { interface Register { server: { requestContext: … } } }`) seeds that same bag. Use it for Workers bindings / per-request env — **read env inside the fetch/middleware, not at module scope** (Workers inject env per request).

Sources:

- https://tanstack.com/start/latest/docs/framework/react/guide/middleware
- https://tanstack.com/start/latest/docs/framework/react/guide/server-entry-point — `Register.server.requestContext`
- https://tanstack.com/start/latest/docs/framework/react/guide/execution-model — module-scope `process.env`
- `packages/start-server-core/src/createStartHandler.ts` — `additionalContext = { serverContext }`
- `packages/router-core/src/load-server.ts` — spread onto beforeLoad/loader options

### 3. Safe per-request server-only values

| Want | Put it |
|---|---|
| Access token, session secret, HMAC secret | ALS (`getCookie` / `getRequest`) or request-middleware context. **Never** `beforeLoad` return, **never** `sendContext` from the client. |
| Shop domain / logged-in flag for UI | `beforeLoad` return (will be on the client) **after** a server function verified the session |
| DB handle / Cloudflare binding | `handler.fetch` `context` / Workers `env` (module augmentation). Read per request. |

Official auth rule (repeated in middleware, server functions, authenticated-routes):

> Auth must be enforced in the handler or middleware for the endpoint that touches private data. **`beforeLoad` is for route UX.**

---

## SSR / streaming and document `<head>`

- **SSR is on by default.** `defaultStreamHandler` streams via `renderRouterToStream` (`@tanstack/react-router/ssr/server`).
- Per-route `ssr: true | false | 'data-only'` (or a server-only function). Default `true`; override globally with `createStart({ defaultSsr })`. Child routes can only become **more restrictive**.
- Root document shell: `src/routes/__root.tsx` renders `<html><head><HeadContent /></head><body>…<Scripts /></body></html>`. If the root `component` has `ssr: false`, still provide `shellComponent` — the shell is always SSRed.
- Streaming is the default HTML path; SEO guide also names “Streaming SSR”.

**Head API name:** `routeOptions.head`, rendered by **`<HeadContent />`** from `@tanstack/react-router`. Body scripts: `routeOptions.scripts` + **`<Scripts />`**.

`head` return shape: `{ meta, links, styles, scripts }`. `head` / `scripts` callbacks receive `{ matches, match, params, loaderData }`.

For App Bridge + API key on every admin page (root route):

```tsx
export const Route = createRootRoute({
  head: () => ({
    meta: [
      { name: 'shopify-api-key', content: publicApiKey }, // client ID; public
    ],
    scripts: [
      { src: 'https://cdn.shopify.com/shopifycloud/app-bridge.js' }, // confirm URL against Shopify docs at implement time
    ],
  }),
  component: RootDocument, // <head><HeadContent /></head>
})
```

`meta` entries with the same `name`/`property` **dedupe** (last nested route wins). Scripts in `head.scripts` are **head** tags via `<HeadContent />`; `routeOptions.scripts` are **body** tags via `<Scripts />` (run after DOM, before hydration). App Bridge belongs in **`head.scripts`**. Inline pre-hydration JS: `ScriptOnce`.

If the key must come from env: read it in a server function / `createServerOnlyFn` and pass via `loader` → `head: ({ loaderData })`, or inline a public `VITE_`-prefixed value. Do not put the **client secret** in `head`.

Sources:

- https://tanstack.com/start/latest/docs/framework/react/guide/routing — `HeadContent`, `Scripts`, root shell
- https://tanstack.com/router/latest/docs/framework/react/guide/document-head-management — `head` object, dedupe, `ScriptOnce`
- https://tanstack.com/router/latest/docs/framework/react/api/router/RouteOptionsType — `head` / `scripts` / `headers`
- https://tanstack.com/start/latest/docs/framework/react/guide/seo — `head({ loaderData })`, SSR default
- https://tanstack.com/start/latest/docs/framework/react/guide/selective-ssr — `shellComponent`, `ssr` modes
- `packages/react-start-server/src/defaultStreamHandler.tsx`

---

## Request-lifecycle hooks for cross-cutting auth

Ordered by where they sit on a request:

1. **`src/server.ts` `fetch(request, opts)`** — outermost. Inject Workers `env`, request IDs. Optional.
2. **Global `requestMiddleware`** (`createStart` in `src/start.ts`) — every Start-handled request: server fns, server routes, SSR. **This is the cross-cutting auth/session-load hook.** Also where CSRF (filtered to `serverFn`) and Origin checks live.
3. **Global `functionMiddleware`** — every `createServerFn` only (plus per-fn `.middleware`).
4. **Server-route `server.middleware` / per-method middleware** — webhooks, callbacks. Skip CSRF; verify HMAC.
5. **`beforeLoad` (then `loader`)** — matched HTML routes, isomorphic. Throw `redirect()` for unauthenticated **UI**. Not a data boundary.
6. **`defaultStreamHandler` / `defineHandlerCallback`** — wrap streaming render; not for auth.

There is no Express-style `app.use` outside this. Session cookie helpers: `useSession` from `@tanstack/react-start/server` (see Authentication guide) or Shopify `SessionStorage` behind middleware that calls `getCookie` / `setCookie`.

Sources:

- https://tanstack.com/start/latest/docs/framework/react/guide/middleware — global request vs function middleware; CSRF
- https://tanstack.com/start/latest/docs/framework/react/guide/authentication-server-primitives — session cookies, `authMiddleware`, CSRF, “Protect Data First”
- https://tanstack.com/start/latest/docs/framework/react/guide/authentication — `beforeLoad` + `getCurrentUserFn` pattern; `useSession`
- https://tanstack.com/router/latest/docs/framework/react/guide/authenticated-routes — `_authenticated` layout, `throw redirect()`

---

## Implications for the port

Aimed at later grilling tickets (`packages/shopify-app-tanstack-start` + `apps/web`). Token-exchange + managed-install only. TanStack-idiomatic, not an API clone of `@shopify/shopify-app-react-router`.

### Auth wiring

- **Data boundary:** `createMiddleware` request middleware that loads the Shopify session from the cookie / session token, plus **the same middleware (or a factory) on every `createServerFn` that talks to Admin API**. A pathless `_authenticated` `beforeLoad` that `throw redirect()`s is **UX only**.
- **Do not** put access tokens on `beforeLoad`’s return value (dehydrated to the client). Return `{ shop }` / `{ isAuthenticated }` if the UI needs them; keep tokens in ALS / middleware context.
- **SSR vs client nav:** `serverContext` on beforeLoad args exists **only during SSR**. Client navigations must call a server function (or read dehydrated public context) to re-check the session. The documented Start pattern is `beforeLoad: async () => { const user = await getCurrentUserFn(); … }`.
- **CSRF:** the package/app will almost certainly ship `src/start.ts` (global auth middleware) → **must** install `createCsrfMiddleware({ filter: (ctx) => ctx.handlerType === 'serverFn' })` so Shopify webhook POSTs are not Origin-checked.

### Context population

- Type router context with `createRootRouteWithContext` for client-safe values (QueryClient, public shop).
- Type Start request context with `Register.server.requestContext` if `src/server.ts` injects bindings.
- Treat `serverContext` (beforeLoad extra arg) as SSR-only; do not document it as the public package API.

### Webhooks as server routes

- File routes under e.g. `routes/webhooks/$.ts` or `routes/api.webhooks.$topic.ts`, `server.handlers.POST` receiving `{ request }`, HMAC over **raw body** (`request.arrayBuffer()` / `.text()`), return `new Response(null, { status: 200 })`.
- Pathless layout middleware for HMAC is fine; **do not** reuse `authMiddleware` that expects an embedded session token.

### App Bridge script in `<head>`

- Root `head.meta`: `{ name: 'shopify-api-key', content }`.
- Root `head.scripts`: App Bridge `<script src>`.
- Render `<HeadContent />` in the root `<head>`. That is the head API (`routeOptions.head` + `HeadContent`), not a React Helmet clone and not `routeOptions.scripts` (those are body).

### Nitro presets vs Node assumption

- App package: **runtime-agnostic** (Web `Request`/`Response`, `getRequest()`, cookies). No `node:http`, no Nitro imports.
- `apps/web` for now: Vite + `tanstackStart()` + `nitro()` (or Rsbuild + `srvx`) + Node start script.
- Later Cloudflare: swap in `@cloudflare/vite-plugin` and `wrangler.jsonc` `main: "@tanstack/react-start/server-entry"`; move env reads into `fetch`. Later AWS: Nitro `aws_lambda` (enable streaming if HTML stream matters) or Node on ECS. Later GCP: `node_server` container. The fetch handler does not change.

### Package surface (TanStack-idiomatic)

Export middleware factories, `createServerFn` helpers, and server-route handler factories — **not** React Router `loader`/`action` signatures and **not** a fake `authenticate.admin` that exists only to mimic Remix. Consumers wire `requestMiddleware` in `src/start.ts` and attach function middleware to server fns.

---

## Facts later tickets depend on

| Item | Fact |
|---|---|
| Target version | `@tanstack/react-start@1.168.49` (+ `@tanstack/react-router@1.170.32`); Start is still **RC** in docs |
| Bundler peer | `vite` `>=7`; Node `>=20.19` (router engines) |
| Auth: data vs UX | **Middleware / server-fn handler = data boundary**; **`beforeLoad` = route UX only** |
| Global auth hook | `createStart({ requestMiddleware })` in `src/start.ts` |
| Head API | `routeOptions.head` → `<HeadContent />`; App Bridge in `head.scripts`; `shopify-api-key` in `head.meta` |
| Webhooks | **Server routes**, not `createServerFn`; exclude from CSRF filter |
| Request object | `getRequest()` from `@tanstack/react-start/server`; server routes also get `{ request }` |
| SSR stream | `defaultStreamHandler` → `renderRouterToStream` |
| Nitro | Optional `nitro/vite`; default Node `node_server`; **not** used for official Cloudflare/Netlify plugins |
| Env | Read per request (middleware / handler), never module scope |
