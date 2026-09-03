/**
 * `shopify-app-tanstack-start/webhooks` — the `/webhooks` export barrel (ADR 0004
 * + ADR 0010 6).
 *
 * - `createAuthenticateWebhook(deps)` — the ADR 0010 6 primitive: validate →
 *   parse → load session, throwing the RR-exact failure `Response`. Also reached
 *   as `shopify.authenticate.webhook`.
 * - `createWebhookHandler(shopify, handlerOrMap, options?)` — ADR 0004's
 *   re-exported polymorphic factory (sugar over the primitive).
 * - `bindWebhookHandlers(deps)` — the IP-3 seam: `createShopifyApp` calls this to
 *   pre-bind `handlers.webhooks` on its return object.
 * - `registerWebhooks` / `bindRegisterWebhooks` — the documented, unused
 *   escape hatch (subscriptions are toml-declared only).
 * - `WebhookHandler` / `WebhookContext` (+ supporting types).
 */
export { bindWebhookHandlers, createAuthenticateWebhook, createWebhookHandler } from './handler.js';
export type {
  AuthenticateWebhook,
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
