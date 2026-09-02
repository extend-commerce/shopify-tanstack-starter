/**
 * WS4 — `registerWebhooks` (ADR 0004 Registration).
 *
 * Shipped as a DOCUMENTED, UNUSED escape hatch. The starter subscribes to
 * webhooks **only** through `shopify.app.toml` `[[webhooks.subscriptions]]` —
 * there is no `webhooks` config field and no `afterAuth` registration (ADR 0004
 * "Considered and rejected": RR's `addHandlers` + `register`-in-`afterAuth` model
 * duplicates the toml and adds post-auth work). This thin wrap of
 * `api.webhooks.register` exists only so an app that wants programmatic
 * subscription is not forced to fork the package.
 *
 * Runtime-agnostic (ADR 0009): no `node:*`; delegates entirely to
 * `@shopify/shopify-api`.
 */
import type { RegisterReturn, Session, Shopify } from '@shopify/shopify-api';

export interface RegisterWebhooksArgs {
  /** An offline `Session` with a valid Admin access token for the shop. */
  session: Session;
}

/**
 * Pre-bind against the `@shopify/shopify-api` instance. `createShopifyApp` uses
 * this to put `registerWebhooks` on its return object (IP-3):
 * `registerWebhooks: bindRegisterWebhooks(api)`.
 */
export function bindRegisterWebhooks(
  api: Pick<Shopify, 'webhooks'>,
): (args: RegisterWebhooksArgs) => Promise<RegisterReturn> {
  return ({ session }) => api.webhooks.register({ session });
}

/**
 * Convenience form for callers holding the `createShopifyApp` return (or any
 * `{ api }`): `registerWebhooks(shopify, { session })`.
 */
export function registerWebhooks(
  shopify: { api: Pick<Shopify, 'webhooks'> },
  args: RegisterWebhooksArgs,
): Promise<RegisterReturn> {
  return bindRegisterWebhooks(shopify.api)(args);
}
