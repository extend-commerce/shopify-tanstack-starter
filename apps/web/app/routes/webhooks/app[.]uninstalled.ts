import { createFileRoute } from '@tanstack/react-router';

import { shopify } from '~/shopify.server';
import { sessionStorage } from '~/db/client';

/**
 * `POST /webhooks/app.uninstalled` (ADR 0004 §starter routes).
 *
 * Server route, never a `createServerFn` (cross-cutting rule #6): Shopify posts
 * an HMAC-signed body cross-origin. `shopify.handlers.webhooks` HMAC-validates
 * over the raw body and hands this single-topic handler
 * `{ shop, topic, webhookId, apiVersion, payload, session? }` (IP-8). The status
 * contract (200 / 401 / 400 / 405 / 500-on-throw) is enforced by the factory.
 *
 * The filename is bracket-escaped (`app[.]uninstalled.ts`) so the generated route
 * path is the literal `/webhooks/app.uninstalled` that `shopify.app.toml`
 * subscribes — a plain `app.uninstalled.ts` would generate `/webhooks/app/uninstalled`.
 *
 * On uninstall, delete the offline session for the shop. Idempotent — a repeat
 * delivery after the row is gone still resolves (→ 200).
 */
const handler = shopify.handlers.webhooks(
  async ({ shop }) => {
    const offlineId = shopify.api.session.getOfflineId(shop);
    await sessionStorage.deleteSession(offlineId);
  },
  { expectedTopic: 'app/uninstalled' },
);

export const Route = createFileRoute('/webhooks/app.uninstalled')({
  server: {
    handlers: {
      // `ANY` (not just `POST`) so the factory itself answers non-POST with 405
      // per the IP-8 status contract, instead of falling through to an SSR 200.
      ANY: ({ request }) => handler({ request }),
    },
  },
});
