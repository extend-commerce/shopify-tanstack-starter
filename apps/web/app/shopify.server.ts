/**
 * The IP-2 + IP-3 nexus: builds the one `createShopifyApp` instance for the app
 * and re-exports the primitives the shell + routes wire in.
 *
 * Runtime bindings (adapter, session storage, auth coordination) come from
 * `~/platform`. Local Vite resolves that to `platform.ts` (Node adapter +
 * file SQLite). `CLOUDFLARE=1` aliases it to `platform.cf.ts` (cf-worker adapter
 * + D1 + KV) — ADR 0011 / 0017.
 *
 * Env is read from `~/platform` (`getShopifyEnv`). Node uses `process.env`
 * (CLI / `.env`). Workers use `cloudflare:workers` `env` so Wrangler secrets
 * are visible (ADR 0011). D1 / KV stay on that `env` object, not `process.env`.
 */
import { createShopifyApp } from 'shopify-app-tanstack-start';
import { authCoordination, getShopifyEnv, sessionStorage } from '~/platform';
import { API_VERSION } from '~/shopify.config';
import { EXCLUDE_PATHS } from '~/shopify.exclude-paths';

const shopifyEnv = getShopifyEnv();

export const shopify = createShopifyApp({
  apiKey: shopifyEnv.apiKey,
  apiSecretKey: shopifyEnv.apiSecretKey,
  appUrl: shopifyEnv.appUrl,
  apiVersion: API_VERSION,
  sessionStorage,
  ...(authCoordination ? { authCoordination } : {}),
  scopes: shopifyEnv.scopes,
  // IP-7 (ADR 0007) — the global-middleware path-exclusion list. The values are
  // owned by WS7 in `~/shopify.exclude-paths`; passed here so `start.ts` gets a
  // fully-configured `requestMiddleware`.
  excludePaths: [...EXCLUDE_PATHS],
});

export const {
  api,
  requestMiddleware,
  adminMiddleware,
  // The `authenticate.*` parity facade (ADR 0010 1). Re-exported here so
  // `defineShopifyMiddleware`'s `loadServerModule` (ADR 0010 3 / IP-note) can
  // resolve `{ requestMiddleware, authenticate }` off `~/shopify.server`, and so
  // server routes can call `shopify.authenticate.<surface>(request)` directly.
  authenticate,
  unauthenticated,
  handlers,
  registerWebhooks,
  addDocumentResponseHeaders,
} = shopify;
