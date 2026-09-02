/**
 * `shopify-app-tanstack-start/webhooks` — the `/webhooks` export barrel (ADR 0004).
 *
 * - `createWebhookHandler(shopify, handlerOrMap, options?)` — ADR 0004's
 *   re-exported polymorphic factory.
 * - `bindWebhookHandlers(deps)` — the IP-3 seam: `createShopifyApp` calls this to
 *   pre-bind `handlers.webhooks` on its return object.
 * - `registerWebhooks` / `bindRegisterWebhooks` — the documented, unused
 *   escape hatch (subscriptions are toml-declared only).
 * - `WebhookHandler` / `WebhookContext` (+ supporting types).
 */
export { bindWebhookHandlers, createWebhookHandler } from './handler.js';
export type {
  EnsureValidOfflineSession,
  ShopifyAppLike,
  WebhookContext,
  WebhookDeps,
  WebhookFactory,
  WebhookHandler,
  WebhookHandlerMap,
  WebhookLogger,
  WebhookRoute,
  WebhookRouteOptions,
} from './handler.js';
export { bindRegisterWebhooks, registerWebhooks } from './register.js';
export type { RegisterWebhooksArgs } from './register.js';
