import { createFileRoute } from '@tanstack/react-router';

import { shopify } from '~/shopify.server';
import { sessionStorage } from '~/platform';

/**
 * `POST /webhooks/app.scopes_update` (ADR 0004 starter routes).
 *
 * Fired when the merchant's granted access scopes change. Persist the new scope
 * string onto the stored offline `Session` so subsequent `adminMiddleware` calls
 * see the current grant. `payload.current` is the authoritative scope set (string
 * or array, depending on delivery version).
 *
 * Filename bracket-escaped so the route path is the literal
 * `/webhooks/app.scopes_update` that `shopify.app.toml` subscribes.
 */
interface ScopesUpdatePayload {
  current?: string | string[];
}

const handler = shopify.handlers.webhooks(
  async ({ shop, payload, session }) => {
    const current = (payload as ScopesUpdatePayload).current;
    const scope = Array.isArray(current) ? current.join(',') : (current ?? '');

    const offlineId = shopify.api.session.getOfflineId(shop);
    const stored = session ?? (await sessionStorage.loadSession(offlineId));
    if (!stored) return;

    stored.scope = scope;
    await sessionStorage.storeSession(stored);
  },
  { expectedTopic: 'app/scopes_update' },
);

export const Route = createFileRoute('/webhooks/app.scopes_update')({
  server: {
    handlers: {
      // `ANY` (not just `POST`) so the factory itself answers non-POST with 405
      // per the IP-8 status contract, instead of falling through to an SSR 200.
      ANY: ({ request }) => handler({ request }),
    },
  },
});
