import { createFileRoute } from '@tanstack/react-router';

import { shopify } from '~/shopify.server';

/**
 * `/auth/$` — the embedded-auth handler (ADR 0002 / ADR 0007), a server-only
 * route (`server.handlers`, no `component`) mounting `shopify.handlers.auth`.
 *
 * Sub-paths (see the package `auth-splat.ts`):
 *   - `/auth/session-token` (and bare `/auth`) → App Bridge `shopify-reload` HTML
 *   - `/auth/exit-iframe`                       → App Bridge `window.open(_top)` HTML
 *   - non-embedded document request             → `getEmbeddedAppUrl` redirect
 *
 * The `_authenticated` layout bounces unauthenticated loads here. `/auth` +
 * `/auth/*` are on the IP-7 exclusion list so the eager middleware never runs.
 * GET and POST both delegate to the same handler.
 */
export const Route = createFileRoute('/auth/$')({
  server: {
    handlers: {
      GET: ({ request, params }) => shopify.handlers.auth({ request, params }),
      POST: ({ request, params }) => shopify.handlers.auth({ request, params }),
    },
  },
});
