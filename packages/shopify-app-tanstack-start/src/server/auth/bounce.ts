import { redirect } from '@tanstack/react-router';
import type { Shopify } from '@shopify/shopify-api';
import type { DerivedConfig } from '../config';

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}

/**
 * `renderAppBridge` (ADR 0002 3.4, RR parity).
 *
 * Not a React route: App Bridge's bounce handshake is a bare document that
 * loads `app-bridge.js` with `data-api-key`, then reloads `shopify-reload`.
 * Shopify's RR helper is the same string `Response` — putting this through
 * `__root` (Polaris, hydration, extra body) breaks the handshake.
 *
 * `Cache-Control: no-store` + a per-shop-sanitised CSP `frame-ancestors`.
 */
export function renderAppBridge(
  api: Shopify,
  config: DerivedConfig,
  opts: { shop?: string; redirectTo?: string } = {},
): Response {
  const apiKey = escapeHtml(config.apiKey ?? '');
  const openScript = opts.redirectTo
    ? `<script>window.open(${JSON.stringify(opts.redirectTo)}, "_top")</script>`
    : '';
  const html = `<script data-api-key="${apiKey}" src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>${openScript}`;

  const headers = new Headers({
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
  });
  const sanitized = opts.shop ? api.utils.sanitizeShop(opts.shop) : null;
  if (sanitized) {
    headers.set(
      'content-security-policy',
      `frame-ancestors https://${sanitized} https://admin.shopify.com;`,
    );
  }

  return new Response(html, { status: 200, headers });
}

/**
 * The shared bounce move (ADR 0002 3.4, RR parity): strip `id_token`, set
 * `shopify-reload=<pathname><search>`, `throw redirect()` to the App Bridge
 * `session-token` reload route.
 *
 * Config-less so it is reusable from an isomorphic `beforeLoad` (the package's
 * `authGuard`, ADR 0010 4) as well as the server-side `redirectToBouncePage`.
 */
export function bounceToSessionToken(args: {
  pathname: string;
  search: string;
  patchSessionTokenPath?: string;
}): never {
  const { pathname, search, patchSessionTokenPath = '/auth/session-token' } = args;
  const params = new URLSearchParams(search);
  params.delete('id_token');
  params.set('shopify-reload', `${pathname}${search}`);
  throw redirect({ href: `${patchSessionTokenPath}?${params.toString()}` });
}

/**
 * `redirectToBouncePage` (ADR 0002 3.4, RR parity): strip `id_token`, set
 * `shopify-reload=<path>?<params>`, `throw redirect()` to the bounce route.
 */
export function redirectToBouncePage(config: DerivedConfig, url: URL): never {
  bounceToSessionToken({
    pathname: url.pathname,
    search: url.search,
    patchSessionTokenPath: config.auth.patchSessionTokenPath,
  });
}
