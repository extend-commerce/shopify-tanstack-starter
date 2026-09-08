/**
 * Cloudflare Workers platform bindings (ADR 0017).
 *
 * Selected by the `~/platform` Vite alias when `CLOUDFLARE=1`. Same exports as
 * `./platform.ts` so `shopify.server.ts` does not change.
 *
 * Imports `@shopify/shopify-api/adapters/cf-worker` directly (amends ADR 0009 /
 * 0011) — the package does not wrap platform adapters.
 */
import { env } from 'cloudflare:workers';
import { cfWorkerAdapterInitialized } from '@shopify/shopify-api/adapters/cf-worker';
import { setAbstractRuntimeString } from '@shopify/shopify-api/runtime';
import type { AuthCoordinationStore } from 'shopify-app-tanstack-start';

import { createKvAuthCoordinationStore } from '~/auth/coordination.kv';

if (!cfWorkerAdapterInitialized) {
  throw new Error('@shopify/shopify-api/adapters/cf-worker failed to initialize');
}

setAbstractRuntimeString(() => 'TanStack Start (Cloudflare Workers)');

export { sessionStorage } from '~/db/client.d1';

export const authCoordination: AuthCoordinationStore | undefined = createKvAuthCoordinationStore();

/**
 * Wrangler `vars` + secrets. Prefer `cloudflare:workers` `env` over `process.env`:
 * secrets are request-bound bindings and are not always copied onto `process.env`
 * at module evaluation (ADR 0011).
 */
export function getShopifyEnv() {
  return {
    apiKey: env.SHOPIFY_API_KEY,
    apiSecretKey: env.SHOPIFY_API_SECRET ?? '',
    appUrl: env.HOST ?? 'http://localhost:3000',
    scopes: env.SCOPES?.split(',').map((s) => s.trim()),
  };
}
