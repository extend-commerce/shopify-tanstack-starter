# TanStack Start on Cloudflare Workers — build, runtime, gotchas

**Ticket:** [ENG-2364](https://linear.app/extend-commerce/issue/ENG-2364/research-tanstack-start-on-cloudflare-workers-build-runtime-gotchas)
**Question:** What does it actually take to run a `@tanstack/react-start` app as a Cloudflare Worker, and what breaks?
**Date:** 2026-09-03
**Sources:** [TanStack Start Cloudflare Workers docs](https://developers.cloudflare.com/workers/framework-guides/web-apps/tanstack-start/) (updated 2026-06-25); [TanStack Start hosting guide](https://tanstack.com/start/latest/docs/framework/react/guide/hosting); [Server entry point docs](https://tanstack.com/start/latest/docs/framework/react/guide/server-entry-point); [`@cloudflare/vite-plugin` changelog](https://developers.cloudflare.com/changelog/product/workers/6/); [TanStack/router#6487](https://github.com/TanStack/router/issues/6487) + [#6488](https://github.com/TanStack/router/pull/6488); [tanstack-start-faster example](https://github.com/Vijayabaskar56/tanstack-start-faster); ADR 0009.

---

## Recommendation

**First-class path exists.** TanStack Start + Cloudflare Workers is an official, documented deployment target with a Vite plugin integration. The build path replaces `nitro()` with `@cloudflare/vite-plugin`'s `cloudflare()`, not a Nitro preset. Custom entry (`src/server.ts`) supports `queue()`, `scheduled()`, and Durable Object exports alongside `fetch`. Bindings are accessed via `import { env } from 'cloudflare:workers'` in server code. SSR streaming works. The main gotcha surface is plugin ordering, the Shopify API adapter import, and the `process.env` → `env` migration.

---

## Versions (2026-09-03)

| Package | Pin / latest | Notes |
|---|---|---|
| `@tanstack/react-start` | catalog **1.168.49** | First-class CF Workers support since ~1.110+; prerendering since 1.138.0 |
| `@cloudflare/vite-plugin` | latest (install as devDep) | Requires Vite 7+ for auxiliary workers; Vite 8.2.2 in catalog is fine |
| `wrangler` | latest (install as devDep) | CLI for dev/deploy/typegen |
| `vite` | catalog **8.2.2** | Vite Environments API is the underlying mechanism |

---

## 1. Build path

**Replace `nitro()` with `cloudflare()`, not a Nitro preset.** The official path uses `@cloudflare/vite-plugin`, not Nitro's `cloudflare-module` or `cloudflare-pages` preset. ADR 0009's assumption is confirmed.

### vite.config.ts change

```ts
// Before (node-server)
import { nitro } from 'nitro/vite';
plugins: [
  tanstackStart({ srcDirectory: 'app' }),
  viteReact(),
  ...(command === 'build' ? [nitro({ preset: 'node-server' })] : []),
]

// After (Cloudflare Workers)
import { cloudflare } from '@cloudflare/vite-plugin';
plugins: [
  cloudflare({ viteEnvironment: { name: 'ssr' } }),  // MUST come first
  tanstackStart({ srcDirectory: 'app' }),
  viteReact(),
]
```

**Critical: `cloudflare()` must be the first plugin**, before `tanstackStart()`. Reversed order causes `server-entry not found` errors because TanStack Start's plugin references the entry point that `cloudflare()` sets up.

Unlike the current config where `nitro()` is build-only, `cloudflare()` runs in both dev and build — it provides Miniflare-backed local dev (`vite dev` runs the Worker runtime locally). The `command === 'build'` guard is removed.

### Worker entry

Default: `"main": "@tanstack/react-start/server-entry"` in `wrangler.jsonc`. For a custom entry (needed for `queue()` / `scheduled()`), point `main` to `./src/server.ts` (or equivalent under `apps/web/app/`).

### wrangler.jsonc (minimal)

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "shopify-tanstack-starter",
  "compatibility_date": "2026-09-03",
  "compatibility_flags": ["nodejs_compat"],
  "main": "./app/server.ts",
  "observability": { "enabled": true }
}
```

### package.json scripts

```json
{
  "dev": "vite dev",
  "build": "vite build",
  "preview": "vite preview",
  "deploy": "pnpm build && wrangler deploy",
  "cf-typegen": "wrangler types"
}
```

The `start` script (`node .output/server/index.mjs`) is removed — there is no `.output/` directory with the Cloudflare plugin. `vite preview` runs a local Miniflare preview of the production build.

---

## 2. Static assets

**Handled by Workers Assets automatically.** When using `@cloudflare/vite-plugin`, client assets are served via the Workers Assets binding. The Vite build outputs client assets into the build directory; `wrangler deploy` uploads them to the Workers Assets CDN.

- Hashed filenames (`/assets/[name]-[hash].js`) get long-lived `Cache-Control: public, max-age=31536000, immutable` headers automatically.
- Non-hashed assets (e.g. `index.html`) get standard short-cache headers.
- No separate `assets: { directory: ... }` config needed in `wrangler.jsonc` when using the Vite plugin — it handles this internally.

**App responses are uncacheable** — every HTML response is per-shop, per-session (embedded app). Cloudflare's CDN cache should not be used for SSR'd HTML. Only static assets benefit from edge caching.

---

## 3. `nodejs_compat`

**Required.** The `nodejs_compat` compatibility flag must be enabled.

| Dependency | Why `nodejs_compat` is needed |
|---|---|
| `@shopify/shopify-api` | Uses Web Crypto (`crypto.subtle`) natively — this works without `nodejs_compat`. However, transitive deps and `Buffer` usage in the ecosystem require the flag. |
| `drizzle-orm/d1` | Pure D1 binding API; no Node deps. `nodejs_compat` is not strictly needed for the D1 driver alone. |
| General npm ecosystem | Many packages check for `process`, `Buffer`, `node:*` stubs. `nodejs_compat` provides polyfills that prevent cryptic module-resolution errors. |

**Shopify API adapter:** The starter's `packages/shopify-app-tanstack-start` must switch from `@shopify/shopify-api/adapters/node` to `@shopify/shopify-api/adapters/cf-worker` (or `/adapters/web-api`). The `cf-worker` adapter is the `web-api` adapter — it uses Web Crypto, Web Fetch, and `btoa`/`atob`. It does not pull in `node:crypto`.

ADR 0009 already planned this: the `adapters/cf-worker` entry in the package imports `@shopify/shopify-api/adapters/cf-worker` and calls `setAbstractRuntimeString`.

**Tree-shaking caution:** Some bundlers aggressively tree-shake the side-effect-only adapter import. The `@shopify/shopify-api` docs recommend importing the exported constant (`cfWorkerAdapterInitialized`) to anchor the import:

```ts
import { cfWorkerAdapterInitialized } from '@shopify/shopify-api/adapters/cf-worker';
if (!cfWorkerAdapterInitialized) throw new Error('Adapter not loaded');
```

---

## 4. SSR streaming

**Works.** TanStack Start uses `defaultStreamHandler` / `createStartHandler` which internally uses `renderToReadableStream` (React 19). Workers natively support `ReadableStream` responses. Streaming SSR is the default — no special configuration needed.

The `@cloudflare/vite-plugin` does not interfere with streaming. Both dev (`vite dev` via Miniflare) and production serve streamed HTML responses.

No buffering caveats found in the current documentation or issue trackers.

---

## 5. Per-request env

**Two mechanisms, both per-request:**

### a) `import { env } from 'cloudflare:workers'` (recommended by Cloudflare)

```ts
import { env } from 'cloudflare:workers';

const getData = createServerFn().handler(() => {
  const db = drizzle(env.DB);          // D1
  const kv = env.SESSION_KV;           // KV
  const queue = env.WEBHOOK_QUEUE;     // Queue
});
```

This is a module-level import but the `env` object is bound per-request by the Workers runtime. It works in server functions, middleware, and loaders. `wrangler types` generates TypeScript types for the bindings.

### b) `getEvent().context.cloudflare.env` (TanStack Start / Nitro legacy)

Some community code uses `getEvent()` from `@tanstack/react-start/server` to access `event.context.cloudflare.env`. This is the older pattern from when TanStack Start ran on Nitro's Cloudflare preset. With the Vite plugin, `import { env } from 'cloudflare:workers'` is the canonical approach.

### Impact on the starter

ADR 0009 says: "Env is read per request — inside middleware / handlers / `handler.fetch` context, never at module scope." The `cloudflare:workers` `env` import satisfies this — Workers bind it per-request despite the module-level import syntax.

**`process.env` is empty at module scope on Workers.** The current `vite.config.ts` forwards root `.env` onto `process.env` for SSR — this pattern does not work on Workers. Environment variables must be configured as `vars` in `wrangler.jsonc` or via `wrangler secret put`, and accessed via `env.VAR_NAME` from `cloudflare:workers`.

**The D1 client must not be constructed at module scope.** `app/db/client.ts` currently creates a `Pool` at module scope — this must become a per-request factory: `const db = drizzle(env.DB)` inside a server function or middleware.

---

## 6. `queue()` and `scheduled()` handlers

**Yes — same Worker, custom entry.** A TanStack Start Worker can export `queue`, `scheduled`, and Durable Object classes alongside `fetch`. The pattern:

```ts
// app/server.ts (or src/server.ts)
import handler from '@tanstack/react-start/server-entry';

export default {
  fetch: handler.fetch,

  async queue(batch, env, ctx) {
    for (const message of batch.messages) {
      // process webhook payload
      message.ack();
    }
  },

  async scheduled(event, env, ctx) {
    console.log('Cron:', event.cron);
  },
};
```

`createServerEntry()` returns a spreadable object (documented in TanStack/router#6487, merged in #6488). `wrangler.jsonc` must point `main` to this custom file instead of `@tanstack/react-start/server-entry`.

**No separate Worker needed for the queue consumer.** The same Worker handles both `fetch` (SSR + API + webhooks) and `queue` (async processing). This is the recommended pattern.

**Auxiliary Workers** are also supported (since Jan 2026, requires Vite 7+) for truly separate Workers called via service bindings, but these are not needed for the webhook queue consumer.

---

## 7. Local dev

### `vite dev` replaces `wrangler dev`

With `@cloudflare/vite-plugin`, `vite dev` runs the Worker locally via Miniflare (embedded in the plugin). D1, KV, and Queues bindings are simulated locally. There is no need to run `wrangler dev` separately.

### `shopify app dev` compatibility

`shopify app dev` runs `apps/web`'s Vite dev command (per ADR 0008). It injects `PORT`, tunnels through `*.trycloudflare.com`, and expects the app to start on the injected port. Since `vite dev` is the command for both Node and Workers targets, `shopify app dev` should continue to work — the `cloudflare()` plugin starts Miniflare transparently behind the Vite dev server.

**Key question for D-localdev (ENG-2373):** Does Miniflare's local D1 + the `shopify app dev` tunnel work end-to-end? The Vite dev server listens on `PORT`; Miniflare provides local D1/KV/Queues storage. This should compose, but needs a try-out. The `server.port` and `server.allowedHosts` config in `vite.config.ts` should carry over.

### Local without a Cloudflare account

Miniflare runs entirely locally — no `wrangler login` needed for `vite dev`. The D1 database is a local SQLite file. KV and Queues are in-memory. This satisfies the "no Cloudflare account locally" requirement.

`wrangler deploy` and `wrangler secret put` do require authentication, but those are maintainer-only operations.

### `.env` handling

Current pattern: `loadEnv()` in `vite.config.ts` forwards root `.env` onto `process.env`. On Workers, env vars come from `wrangler.jsonc` `vars` or `.dev.vars` (Wrangler's local secrets file). The `.dev.vars` file is the Workers equivalent of `.env` for local dev.

D-localdev must decide: keep the root `.env` as the single source and have the Vite config translate to Miniflare vars, or adopt `.dev.vars` for Workers-specific vars and keep `.env` for Shopify CLI vars (API key, etc.).

---

## 8. Known gotchas / open issues

### a) Plugin ordering (critical)

`cloudflare()` **must** be the first plugin in the Vite plugins array, before `tanstackStart()`. Reversed order causes `server-entry not found` build errors. Well-documented but easy to miss.

### b) ServerFn on Cloudflare Pages (not Workers)

A Feb 2026 blog post reports ServerFn not working on Cloudflare **Pages** SSR. This is specific to Pages, not Workers. The starter targets Workers, not Pages. Not a blocker.

### c) `process.env` at module scope

`process.env.X` is `undefined` at module scope on Workers, even with `nodejs_compat`. Code that reads env at module scope (e.g. `const connectionString = process.env.DATABASE_URL`) must move to per-request access via `cloudflare:workers` `env`. The current `app/db/client.ts` is the primary instance.

### d) Bundle size

Workers have a 10 MB compressed limit (25 MB uncompressed on paid plans). A full TanStack Start app with Shopify API + Drizzle should be well under this, but worth monitoring. The `nitro/vite` to `cloudflare()` switch changes the bundle strategy.

### e) CPU time limits

Workers Paid: 30 seconds CPU time per request. Most SSR renders are <100ms. Webhook processing in the `queue()` handler has the same limit per batch invocation. Not a concern for typical Shopify app workloads.

### f) Memory limit

Workers: 128 MB per isolate. This is ample for SSR but means large in-memory caches are not viable. Session storage in D1 (not in-memory) is the right pattern.

### g) No `node:net` / `node:tls`

`pg` (the Postgres driver) uses `node:net` and `node:tls` — it **cannot** run on Workers. This is already documented in ADR 0009 and is the reason for the D1 migration. If Postgres were kept, Hyperdrive + a HTTP-based driver (`@neondatabase/serverless`, `postgres` over WebSocket) would be required.

### h) Tree-shaking of adapter imports

Vite's production build may tree-shake the `import '@shopify/shopify-api/adapters/cf-worker'` side-effect import. Use the named export anchor (see section 3).

### i) `wrangler.jsonc` auto-detection

Running `wrangler deploy` without a `wrangler.jsonc` auto-detects TanStack Start and generates config on the fly. This is convenient for quick deploys but should not be relied on for production — the starter should ship an explicit `wrangler.jsonc`.

---

## Implications for decision tickets

| Ticket | Implication |
|---|---|
| **D-build (ENG-2367)** | Swap `nitro()` for `cloudflare()`. Custom `server.ts` entry for `queue()`. Plugin ordering is critical. No `.output/` directory. |
| **D-data (ENG-2368)** | `app/db/client.ts` must become a per-request factory (`drizzle(env.DB)`). No module-scope `Pool`. |
| **D-session-kv (ENG-2369)** | KV accessed via `env.SESSION_KV` from `cloudflare:workers`. |
| **D-webhooks (ENG-2370)** | `queue()` handler in the same Worker entry. `batch.messages` + `message.ack()`. |
| **D-localdev (ENG-2373)** | `vite dev` + Miniflare replaces `wrangler dev`. `shopify app dev` should compose. `.dev.vars` vs `.env` needs decision. |
| **D-envs (ENG-2372)** | Env vars via `wrangler.jsonc` `vars` + `wrangler secret put`. No `process.env` at module scope. |

---

## Primary sources

| Claim | Source |
|---|---|
| `cloudflare()` before `tanstackStart()` in plugins | [CF Workers TanStack Start docs](https://developers.cloudflare.com/workers/framework-guides/web-apps/tanstack-start/), [TanStack hosting guide](https://tanstack.com/start/latest/docs/framework/react/guide/hosting) |
| `main: "@tanstack/react-start/server-entry"` | [CF Workers TanStack Start docs](https://developers.cloudflare.com/workers/framework-guides/web-apps/tanstack-start/) |
| Custom entry with `queue()` / `scheduled()` | [CF Workers TanStack Start docs § Custom entrypoints](https://developers.cloudflare.com/workers/framework-guides/web-apps/tanstack-start/#custom-entrypoints), [TanStack/router#6487](https://github.com/TanStack/router/issues/6487) |
| `import { env } from 'cloudflare:workers'` for bindings | [CF Workers TanStack Start docs § Bindings](https://developers.cloudflare.com/workers/framework-guides/web-apps/tanstack-start/#bindings) |
| SSR streaming via `defaultStreamHandler` | [TanStack Start server entry docs](https://tanstack.com/start/latest/docs/framework/react/guide/server-entry-point), [streaming SSR guide](https://tanstackship.com/blog/streaming-ssr-deep-dive) |
| `@shopify/shopify-api/adapters/cf-worker` | [npm @shopify/shopify-api](https://www.npmjs.com/package/@shopify/shopify-api), [Shopify/shopify-app-js#3161](https://github.com/Shopify/shopify-app-js/issues/3161) |
| Miniflare in `vite dev`, no CF account needed | [CF Workers docs](https://developers.cloudflare.com/workers/framework-guides/web-apps/tanstack-start/), [`@cloudflare/vite-plugin` changelog](https://developers.cloudflare.com/changelog/product/workers/6/) |
| Auxiliary Workers (Vite 7+) | [CF changelog 2026-01-20](https://developers.cloudflare.com/changelog/post/2026-01-20-auxiliary-workers/) |
| `pg` not Workers-compatible | ADR 0009 |
| Plugin ordering gotcha | [sakimyto.com pitfalls post](https://sakimyto.com/en/blog/tanstack-start-cloudflare-pages), CF docs |
