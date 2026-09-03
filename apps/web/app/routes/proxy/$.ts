import { createFileRoute } from '@tanstack/react-router';

import { shopify } from '~/shopify.server';

/**
 * `/proxy/*` — an App Proxy example (ADR 0010 7), a server-only route
 * (`server.handlers`, no `component`).
 *
 * Configure a matching App proxy in `shopify.app.toml` (`[app_proxy]` — e.g.
 * `prefix = "apps"`, `subpath = "proxy"`, `url = "<app-url>/proxy"`); Shopify
 * then serves `https://<shop-domain>/apps/proxy/*` from here, appending the HMAC
 * `signature` + `shop` / `logged_in_customer_id` / `timestamp` query params.
 *
 * `shopify.authenticate.public.appProxy(request)` verifies that HMAC and returns
 * `{ liquid, session?, admin?, storefront? }` — `session` / `admin` / `storefront`
 * only when the shop has an offline token on file. On a bad signature it throws a
 * `400` `Response`, which is returned as-is.
 *
 * `/proxy/*` is on the IP-7 exclusion list (`~/shopify.exclude-paths`) so the
 * eager embedded-auth middleware never runs here — a proxied storefront request
 * carries no session token.
 *
 * This demo renders a Liquid fragment via the `liquid()` helper (relative
 * `<a href>` / `<form action>` get a trailing slash added; pass `{ layout: false }`
 * to skip the theme layout). Swap in your own logic — read `payload` from a POST,
 * call `admin.graphql(...)` when `session` is present, etc.
 */
async function handle(request: Request): Promise<Response> {
  try {
    const { liquid, session } = await shopify.authenticate.public.appProxy(request);
    const shopLine = session
      ? `Signed in — offline session for <strong>${session.shop}</strong>.`
      : 'No offline session on file for this shop.';
    return liquid(
      `<h1>App proxy demo</h1>
       <p>${shopLine}</p>
       <p>Rendered by the TanStack Start starter at <code>/proxy</code>.</p>`,
    );
  } catch (error) {
    if (error instanceof Response) return error;
    throw error;
  }
}

export const Route = createFileRoute('/proxy/$')({
  server: {
    handlers: {
      GET: ({ request }) => handle(request),
      POST: ({ request }) => handle(request),
    },
  },
});
