import { resolve } from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { nitro } from 'nitro/vite';

/**
 * DEPLOYMENT PORTABILITY SWAP POINT (ADR 0009).
 *
 * The `nitro({ preset })` below is the build-target seam. `node-server` is the
 * only target this starter ships. A Cloudflare Workers move swaps `nitro()` for
 * `@cloudflare/vite-plugin` (+ `wrangler.jsonc`); AWS Lambda swaps the preset to
 * `aws_lambda`; ECS / Cloud Run keep `node-server` and containerize `.output/`.
 * See docs/adr/0009 for the per-target change tables. The other non-portable
 * file is `app/db/client.ts` (the `pg` driver).
 *
 * `nitro()` is applied for `vite build` only. In dev, TanStack Start's own
 * dev-server middleware handles SSR; the pinned `nitro@3.0.x-beta` dev worker
 * looks for a Vite env named `ssr` while Start registers it as `server`, so
 * leaving `nitro()` in the dev pipeline 500s every request
 * (`Vite environment "ssr" is unavailable`). Prod build + `node .output/server/index.mjs`
 * are unaffected.
 */
export default defineConfig(({ command, mode }) => {
  // `.env` lives at the MONOREPO ROOT (next to `shopify.app.toml`), so
  // `shopify app env pull` and this app read the same file. Vite only exposes
  // `VITE_`-prefixed vars on `import.meta.env`; server code here reads
  // `process.env`, so forward the (non-prefixed) root `.env` onto `process.env`
  // for SSR — without overriding a var the Shopify CLI already injected
  // (`shopify app dev` sets SHOPIFY_API_KEY / HOST / PORT itself; DATABASE_URL
  // only ever comes from `.env`). Standalone tooling loads `.env` itself:
  // `drizzle.config.ts` (dotenv), `db:seed` / `start` (`node --env-file-if-exists`).
  const rootEnv = loadEnv(mode, resolve(import.meta.dirname, '../..'), '');
  for (const [key, value] of Object.entries(rootEnv)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }

  return {
    resolve: {
      // Resolve the `~/*` -> `./app/*` alias from tsconfig.json for every module,
      // including the `start.ts` entry the Start handler loads outside the normal
      // transform pipeline (a bare `pnpm dev` 500s on `~/shopify.middleware`
      // without this).
      tsconfigPaths: true,
    },
    server: {
      // `shopify app dev` injects PORT; fall back to 3000 for a bare `pnpm dev`.
      port: Number(process.env.PORT) || 3000,
      // `shopify app dev` tunnels through *.trycloudflare.com / *.shopify.dev —
      // Vite 8 blocks unknown hosts otherwise. Embedded dev needs the tunnel
      // (`--use-localhost` does not embed cleanly — ADR 0006).
      allowedHosts: true,
    },
    plugins: [
      // `tanstackStart()` must come before `viteReact()`. `srcDirectory: 'app'`
      // matches the route/codegen paths (ADR 0008).
      tanstackStart({ srcDirectory: 'app' }),
      viteReact(),
      ...(command === 'build' ? [nitro({ preset: 'node-server' })] : []),
    ],
    ssr: {
      // The framework-glue package is consumed as JIT TypeScript source, not a
      // built dist — Vite must transform it rather than externalize it (ADR 0008).
      noExternal: ['shopify-app-tanstack-start'],
    },
  };
});
