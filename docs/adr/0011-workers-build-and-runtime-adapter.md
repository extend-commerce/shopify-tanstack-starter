# Workers build and runtime adapter

**Amends [ADR 0008](0008-monorepo-scaffold-and-tooling.md)** (prod serve) and
**[ADR 0009](0009-runtime-assumptions-and-deployment-portability.md)** (executes the
`vite.config.ts` swap point; app imports `@shopify/shopify-api/adapters/cf-worker`).

Decision: ENG-2367. Research: ENG-2364 (`docs/research/deploy-tanstack-workers.md`).
Numbered **0011** because ADR 0010 is the package public-API facade.

## Decision

1. **Build.** Hosted target is Cloudflare Workers via `@cloudflare/vite-plugin`'s
   `cloudflare({ viteEnvironment: { name: 'ssr' } })`, **not** a Nitro
   `cloudflare-module` preset. `cloudflare()` is the first plugin, then
   `tanstackStart({ srcDirectory: 'app' })`, then `viteReact()`.
2. **Two build modes, one `vite.config.ts`.** `shopify app dev` / `pnpm --filter web
   dev` stay on Node (TanStack Start's Vite SSR + `nitro({ preset: 'node-server' })`
   for `vite build`). The Workers path is opted into with `CLOUDFLARE=1` (used by
   `pnpm --filter web deploy`). This keeps app-developer DX identical (ADR 0017).
3. **Shopify API adapter lives in the app.** `platform.cf.ts` imports
   `@shopify/shopify-api/adapters/cf-worker` (named `cfWorkerAdapterInitialized`
   so the side-effect is not tree-shaken) and sets the runtime string. The package
   does **not** ship `/adapters/cf-worker` (amends ADR 0009). Vite aliases
   `~/platform` → `platform.cf.ts` when `CLOUDFLARE=1`.
4. **`wrangler.jsonc`** lives in `apps/web/`. `nodejs_compat` is required.
   `main` is `./app/server.ts` (re-exports `@tanstack/react-start/server-entry`).
   Wrangler cannot use the package specifier as `main` — it looks for a file.
   Bindings: `DB` (D1), `AUTH_KV` (KV). Staging uses `wrangler.jsonc`;
   production uses `wrangler.production.jsonc` via `WRANGLER_CONFIG` (ADR 0015 / 0016).
   Never `wrangler deploy -c` — Wrangler then skips Vite.
5. **Static assets.** Workers Assets (the Vite plugin) serve hashed client assets
   with immutable caching. App / Admin GraphQL HTML and JSON are **not** cached —
   they are per-shop, per-session. No Cache API / KV response cache in this phase.
6. **CSP `frame-ancestors`.** ADR 0002/0006's `setResponseHeader` path is WinterCG
   headers and is unchanged on Workers.

## Why

- Official TanStack Start + Workers path is the Vite plugin, not Nitro.
- Keeping Node as the `shopify app dev` runtime avoids requiring `wrangler login`
  for everyday app work (map standing preference; ADR 0017).
- The Shopify API adapter stays in `platform.cf.ts` (app-owned), so engineers
  targeting other hosts do not inherit a package adapter catalog.

## Considered and rejected

- **Nitro `cloudflare-module` / `cloudflare-pages`.** Unofficial vs the Vite plugin;
  research (ENG-2364) rejected it.
- **Always-on `cloudflare()` in `vite dev`.** Would run Miniflare and change the
  `shopify app dev` loop. Deferred until an app author actually wants Worker-local
  emulation (ADR 0017).
- **Separate `vite.config.cloudflare.ts` only.** Wrangler auto-loads `vite.config.ts`;
  a flag inside the one config is the seam Wrangler will actually see.

## Consequences

- `pnpm --filter web build` still produces `.output/` (Node). `CLOUDFLARE=1 pnpm
  --filter web deploy` produces a Worker.
- ADR 0009's "no example configs" rationale is superseded: this effort owns the
  configs and will keep them green against the plugin.
