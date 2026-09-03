# Client bundle & navigation-perf audit

**Verdict:** No server-only code leaks into the production client bundle, and no
perf bug in app/package code. The "everything is loading in the browser / nav is
slow" observation is fully explained by **Vite dev mode** (`shopify app dev`
serves hundreds of unbundled modules) plus the **known embedded-iframe hydration
cost** (`polaris.js` + `app-bridge.js` + `hydrateRoot(document)` + App Bridge
init — flagged in ADR 0006 and the ENG-2335 prototype: "embedded hydration is a
few seconds slower than a direct load"). Investigated at `main` `38f856c`.

> This is a static analysis (bundle contents + isomorphic-code read). The
> heavier browser-timed navigation measurement was not completed (the agent run
> stalled); given the dev-mode explanation it is low value. Re-run if a
> production-served nav still feels slow.

## 1. Production client bundle — what actually ships

`apps/web/.output/public/assets/` (nitro `node-server` build):

| Chunk | Raw | Contents |
|---|---:|---|
| `index-*.js` | 342 kB (108 kB gzip / 93 kB brotli) | React 19 + react-dom, `@tanstack/react-router` + `@tanstack/history`, `@tanstack/react-start` client runtime, `@tanstack/react-query`, the `AppProxyProvider`/`AppProxyLink` components, the `authGuard`/`hydrateRouterContext` helpers (client-safe, tiny) |
| `app-*.js` | 7.9 kB | `/app` index page (product-create demo) |
| `proxy-demo-*.js` | 949 B | `/app/proxy-demo` static page |
| `_authenticated-*.js` | 718 B | the `shopify:navigate` listener + `<s-app-nav>` |
| `additional-*.js` | 686 B | `/app/additional` static page |
| `QueryClientProvider-*.js` | 374 B | React Query provider shim |
| `routes-*.js` | 291 B | `/` "open from admin" banner |
| **total** | **353 kB** (~110 kB gzip) | |

93 kB brotli for React 19 + Router + Start + Query is normal-to-lean (Next.js
first-load JS is routinely 200–400 kB+). Routes are code-split; every non-index
route chunk is < 1 kB.

### Server surface: confirmed absent from every client chunk

Grepped all `*.js` in `.output/public/assets/`:

- **No `@shopify/*` npm package** — not `@shopify/shopify-api`, `@shopify/admin-api-client`, `@shopify/graphql-client`, `@shopify/app-bridge*`. (App Bridge + Polaris load from `cdn.shopify.com` `<script>` tags, by design.)
- **No** `decodeSessionToken` · `tokenExchange` / `token-exchange` · `validateHmac` / `createHmac` · `jose` / `jsonwebtoken` · `RequestedTokenType` · `SessionStorage` / `DrizzleSession` · `createShopifyApp` · `drizzle` · `pg` / `pg-pool` · `AsyncLocalStorage` · `SHOPIFY_API_SECRET` / `apiSecretKey`.
- The `authenticate.*` facade (`packages/.../src/server/authenticate.ts`), `bounce.ts`, `admin.ts`, `config.ts`, `shopify-app.ts`, `unauthenticated.ts`, `webhooks/**`, `apps/web/app/shopify.server.ts` — none present.
- `apps/web/app/routes/proxy/$.ts` and `routes/webhooks/*` (server-only routes, no `component`) and their `~/shopify.server` import — fully tree-shaken out of the client.
- Apparent hits are all benign: `node:` ×13 = `{node:…}` object literals in Router's route-matching trie; `authenticate` ×9 = the `/_authenticated` route id + a comment string in the `additional` demo; `shopify-api` ×1 = the `name="shopify-api-key"` `<meta>` string in `__root`.

The `defineShopifyMiddleware` / `createIsomorphicFn` split (ADR 0010 §3) and the
`authGuard` / `hydrateRouterContext` `.`-entry exports (ADR 0010 §4) are doing
their job — the isomorphic `beforeLoad` helpers ship, their server dependencies
do not.

## 2. Dev vs production

`shopify app dev` runs Vite in dev mode: every source module and every
`node_modules/.vite/deps/*` prebundle is a separate un-bundled HTTP request. The
DevTools Network panel shows hundreds of entries — many named like server
libraries — and over a Cloudflare tunnel inside the admin iframe it is slow.
**None of it is in the production bundle** (section 1). This is expected Vite
behaviour, not an architecture problem.

## 3. Isomorphic-execution inventory (`apps/web`)

Everything that runs on both server and client, and what it does:

| Site | Runs | Assessment |
|---|---|---|
| `router.tsx` `getRouter()` | both | Creates `QueryClient` + router. No server work. `defaultPreload: 'intent'` + `defaultPreloadStaleTime: 0` — see note below. |
| `__root` `beforeLoad: hydrateRouterContext` | both | Server: reads `serverContext.shopify`. Client: falls back to `window.shopify`. No secret, no network. |
| `__root` `loader` | both | `process.env.SHOPIFY_API_KEY ?? ''` — `undefined` on client (value dehydrates from SSR); guarded, not a leak. |
| `_authenticated` `beforeLoad: authGuard` | both | Client-safe: `window.shopify` short-circuit / `context.isAuthenticated` pass / `throw redirect()`. No network. |
| `_authenticated/app/` `loader` | both | `({ context }) => ({ shop: context.shop })` — trivial, no network. |
| `/` `beforeLoad` | both | Query-string redirect logic only. |
| route components | client (hydrate) + SSR | `<s-*>` web components + `useMutation` → `createServerFn` RPC. Correct. |

No isomorphic code performs server-only work on the client, accesses a secret,
makes a network call in a `loader`/`beforeLoad`, or pulls a server module that
only survives by tree-shaking on a fragile path.

## 4. One targeted improvement (optional, unrelated to the reported slowness)

`router.tsx` sets `defaultPreloadStaleTime: 0` alongside `defaultPreload:
'intent'`. With stale-time 0, data preloaded on link-hover is treated as
immediately stale and the loader re-runs on the actual navigation — partly
defeating the preload. TanStack's guidance is a small non-zero value (e.g.
`10_000`). Invisible here (loaders do no I/O), but as a **starter template** it
hands consumers a slightly wrong default. One-line change, preserves the public
API and all app behaviour. File as a follow-up if desired.

## 5. Is TanStack Start a good fit? (the retro question)

Nothing in this audit argues against it. The client/server boundary is clean
(section 1), the isomorphic surface is small and does no improper work
(section 3), and the production bundle is lean (section 1). The costs that make
the embedded app *feel* heavy — `polaris.js`, `hydrateRoot(document)`, App Bridge
init, iframe + tunnel latency — are Shopify-embedded-app costs that any framework
pays; they are documented in ADR 0006. The dev-mode request volume is a Vite
trait, not a Start trait.
