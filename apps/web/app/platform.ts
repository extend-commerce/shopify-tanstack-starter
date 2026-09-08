/**
 * Node / `shopify app dev` platform bindings (ADR 0017).
 *
 * `shopify.server.ts` imports this module. The Cloudflare Vite config aliases
 * `~/platform` to `./platform.cf.ts` when `CLOUDFLARE=1`.
 *
 * Runtime polyfills come from `@shopify/shopify-api/adapters/*` here in the app —
 * not from package wrapper subpaths (amends ADR 0009). A different host swaps
 * this file (or the Vite alias target) and picks its own adapter.
 */
// oxlint-disable-next-line import/no-unassigned-import -- Shopify API adapter is imported for effect
import '@shopify/shopify-api/adapters/node';
import { setAbstractRuntimeString } from '@shopify/shopify-api/runtime';

import type { AuthCoordinationStore } from 'shopify-app-tanstack-start';

setAbstractRuntimeString(() => 'TanStack Start (Node)');

export { sessionStorage } from '~/db/client';

/** Local Node keeps the package's in-memory default (ADR 0013 / 0017). */
export const authCoordination: AuthCoordinationStore | undefined = undefined;

/** CLI-injected / `.env` values. Read at `createShopifyApp` time. */
export function getShopifyEnv() {
  return {
    apiKey: process.env.SHOPIFY_API_KEY,
    apiSecretKey: process.env.SHOPIFY_API_SECRET ?? '',
    appUrl: process.env.HOST ?? process.env.SHOPIFY_APP_URL ?? 'http://localhost:3000',
    scopes: process.env.SCOPES?.split(',').map((s) => s.trim()),
  };
}
