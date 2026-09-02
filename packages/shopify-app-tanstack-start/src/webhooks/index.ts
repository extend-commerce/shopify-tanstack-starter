/* ⚠️  PLACEHOLDER — WS4 (ADR 0004) OWNS THIS FILE.
 *
 * It exists ONLY so `createShopifyApp().handlers.webhooks` has a value and the
 * `shopify-app-tanstack-start/webhooks` export resolves before WS4 lands.
 *
 * THE MERGE MUST TAKE WS4's VERSION OF THIS FILE WHOLESALE (handler.ts +
 * register.ts + index.ts). Nothing in WS2/WS3 depends on the behaviour below —
 * only on the `handlers.webhooks` factory *shape* (IP-3): a function taking a
 * `WebhookHandler` or a topic-keyed map and returning a server-route handler.
 * WS4 must keep that shape (IP-8).
 */
import type { Session } from '@shopify/shopify-api';

/** IP-8 — the payload a webhook handler receives (no `admin` client; ADR 0004). */
export interface WebhookHandlerInput {
  shop: string;
  topic: string;
  webhookId: string;
  apiVersion: string;
  payload: unknown;
  session?: Session;
}

export type WebhookHandler = (input: WebhookHandlerInput) => void | Promise<void>;

/** A single per-topic handler, or a topic-keyed map for a splat route. */
export type WebhookHandlers = WebhookHandler | Record<string, WebhookHandler>;

export type WebhookRouteHandler = (ctx: {
  request: Request;
  params?: { _splat?: string };
}) => Promise<Response>;

export function createWebhookHandlers(
  _internals: unknown,
  _handlers: WebhookHandlers,
): WebhookRouteHandler {
  return async () =>
    new Response(
      'shopify-app-tanstack-start: webhook handler placeholder — WS4 owns the real implementation (ADR 0004)',
      { status: 501 },
    );
}
