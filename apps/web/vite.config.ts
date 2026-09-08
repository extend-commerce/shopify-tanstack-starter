import { resolve } from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { nitro } from 'nitro/vite';
import { cloudflare } from '@cloudflare/vite-plugin';

/**
 * DEPLOYMENT PORTABILITY SWAP POINT (ADR 0009 / ADR 0011).
 *
 * Two modes, one file:
 *   - Default (`shopify app dev`, `pnpm --filter web dev` / `build` / `start`):
 *     TanStack Start Vite SSR + `nitro({ preset: 'node-server' })` on `vite build`.
 *   - `CLOUDFLARE=1` (`pnpm --filter web deploy`): `@cloudflare/vite-plugin`
 *     first, no nitro, `~/platform` aliased to the Workers bindings module.
 *
 * The other non-portable file is `app/db/client.ts` (better-sqlite3; Workers
 * uses `app/db/client.d1.ts` via the platform alias).
 *
 * `nitro()` is applied for Node `vite build` only. In dev, TanStack Start's own
 * dev-server middleware handles SSR; the pinned `nitro@3.0.x-beta` dev worker
 * looks for a Vite env named `ssr` while Start registers it as `server`, so
 * leaving `nitro()` in the Node-dev pipeline 500s every request.
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

  const invokedViaWrangler = process.argv.some(
    (arg) => arg === 'wrangler' || /(?:^|[/\\])wrangler(?:\.js)?$/.test(arg),
  );
  const lifecycle = process.env.npm_lifecycle_event;
  const isCloudflare =
    process.env.CLOUDFLARE === '1' ||
    lifecycle === 'deploy' ||
    lifecycle === 'deploy:staging' ||
    lifecycle === 'deploy:production' ||
    lifecycle === 'build:cf' ||
    lifecycle === 'preview:cf' ||
    lifecycle === 'cf-typegen' ||
    invokedViaWrangler ||
    typeof process.env.CLOUDFLARE_ENV === 'string' ||
    typeof process.env.WRANGLER_CONFIG === 'string';
  const wranglerConfigPath = process.env.WRANGLER_CONFIG;

  return {
    resolve: {
      // Resolve the `~/*` -> `./app/*` alias from tsconfig.json for every module,
      // including the `start.ts` entry the Start handler loads outside the normal
      // transform pipeline (a bare `pnpm dev` 500s on `~/shopify.middleware`
      // without this).
      tsconfigPaths: true,
      alias: isCloudflare
        ? {
            '~/platform': resolve(import.meta.dirname, 'app/platform.cf.ts'),
          }
        : undefined,
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
      // Remap Node-only modules before tsconfig `~/*` paths. Webhook routes
      // used to import `~/db/client` (better-sqlite3); that pulled
      // `path.resolve(undefined)` into the Worker and 500'd every request.
      ...(isCloudflare
        ? [
            {
              name: 'workers-platform-alias',
              enforce: 'pre' as const,
              resolveId(id: string) {
                if (id === '~/platform' || id.endsWith('/app/platform.ts')) {
                  return resolve(import.meta.dirname, 'app/platform.cf.ts');
                }
                if (id === '~/db/client' || id.endsWith('/app/db/client.ts')) {
                  return resolve(import.meta.dirname, 'app/db/client.d1.ts');
                }
                return undefined;
              },
            },
          ]
        : []),
      // `cloudflare()` MUST be first among framework plugins (ADR 0011).
      ...(isCloudflare
        ? [
            cloudflare({
              viteEnvironment: { name: 'ssr' },
              // Default: wrangler.jsonc (staging). Production sets WRANGLER_CONFIG.
              // Do not pass `wrangler deploy -c` — that skips Vite (ADR 0011).
              ...(wranglerConfigPath ? { configPath: wranglerConfigPath } : {}),
            }),
          ]
        : []),
      // `tanstackStart()` must come before `viteReact()`. `srcDirectory: 'app'`
      // matches the route/codegen paths (ADR 0008).
      tanstackStart({ srcDirectory: 'app' }),
      viteReact(),
      ...(!isCloudflare && command === 'build' ? [nitro({ preset: 'node-server' })] : []),
    ],
    ssr: {
      // The framework-glue package is consumed as JIT TypeScript source, not a
      // built dist — Vite must transform it rather than externalize it (ADR 0008).
      noExternal: ['shopify-app-tanstack-start'],
    },
  };
});
