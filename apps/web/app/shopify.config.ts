/**
 * The single source of truth for the Admin API version (ADR 0008).
 *
 * A specific dated version — NOT `LATEST_API_VERSION` — so GraphQL codegen output
 * is reproducible and webhook payload versions do not drift under CI.
 *
 * Imported by:
 *   - the `createShopifyApp` runtime config (apps/web/app/shopify.server.ts), and
 *   - `.graphqlrc.ts` (schema + generated types are version-locked).
 *
 * The one copy that cannot import this module is `shopify.app.toml`'s
 * `[webhooks] api_version`; it carries a "keep in sync" comment.
 */
export const API_VERSION = '2026-07' as const;
