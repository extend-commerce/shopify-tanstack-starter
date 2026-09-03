/**
 * The IP-2 + IP-3 nexus: builds the one `createShopifyApp` instance for the app
 * and re-exports the primitives the shell + routes wire in.
 *
 * `import 'shopify-app-tanstack-start/adapters/node'` for effect FIRST — it binds
 * `@shopify/shopify-api` to the Node runtime (ADR 0009). A Workers/Lambda move
 * swaps this one import for the matching `/adapters/*` sibling.
 *
 * Env is read at module scope here (not per-request). That is fine for the
 * `node-server` target; a Workers target — where module-scope `process.env` is
 * empty — restructures this into a per-request factory behind the same exports.
 */
// oxlint-disable-next-line import/no-unassigned-import -- adapter is imported for effect (ADR 0009)
import 'shopify-app-tanstack-start/adapters/node';
import { createShopifyApp } from 'shopify-app-tanstack-start';
import { sessionStorage } from '~/db/client';
import { API_VERSION } from '~/shopify.config';
import { EXCLUDE_PATHS } from '~/shopify.exclude-paths';

export const shopify = createShopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET ?? '',
  appUrl: process.env.HOST ?? process.env.SHOPIFY_APP_URL ?? 'http://localhost:3000',
  apiVersion: API_VERSION,
  sessionStorage,
  scopes: process.env.SCOPES?.split(',').map((s) => s.trim()),
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
