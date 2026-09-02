import { createFileRoute } from '@tanstack/react-router';

import { shopify } from '~/shopify.server';

/**
 * `POST /webhooks/compliance/*` (ADR 0004 §starter routes).
 *
 * The three mandatory GDPR topics, wired as a topic-keyed MAP (splat route).
 * `shopify.app.toml` points all three privacy-compliance URLs under
 * `/webhooks/compliance/…`, so one splat route with an `api.webhooks.validate`
 * HMAC check covers them. Keys are `resource/action` (slash form), matching the
 * toml subscription topics; the factory also tolerates the `RESOURCE_ACTION`
 * enum form.
 *
 * These are acknowledgement stubs — a real app records the request / performs the
 * deletion. Returning `200` (the factory default on handler resolve) tells
 * Shopify the obligation is acknowledged. An unknown topic under this splat is
 * also acknowledged with `200` by the factory.
 */
const noop = async () => {
  // TODO: implement data export / redaction for your data model.
};

const handler = shopify.handlers.webhooks({
  'customers/data_request': noop,
  'customers/redact': noop,
  'shop/redact': noop,
});

export const Route = createFileRoute('/webhooks/compliance/$')({
  server: {
    handlers: {
      // `ANY` (not just `POST`) so the factory itself answers non-POST with 405
      // per the IP-8 status contract, instead of falling through to an SSR 200.
      ANY: ({ request }) => handler({ request }),
    },
  },
});
