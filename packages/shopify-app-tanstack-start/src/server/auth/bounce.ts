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
 * `renderAppBridge` (ADR 0002 §3.4, RR parity).
 *
 * The App Bridge `shopify-reload` HTML: loads `app-bridge.js` with the API key so
 * App Bridge can (a) reload the parent frame to the `shopify-reload` query param
 * after minting a fresh session token — the bounce case — or (b) `window.open` a
 * target `_top` — the exit-iframe case (`redirectTo`).
 *
 * `Cache-Control: no-store` + a per-shop-sanitised CSP `frame-ancestors`.
 */
export function renderAppBridge(
  api: Shopify,
  config: DerivedConfig,
  opts: { shop?: string; redirectTo?: string } = {},
): Response {
  const openScript = opts.redirectTo
    ? `<script>window.open(${JSON.stringify(opts.redirectTo)}, "_top")</script>`
    : '';

  const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="shopify-api-key" content="${escapeHtml(config.apiKey ?? '')}" />
    <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>
    ${openScript}
  </head>
  <body></body>
</html>`;

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
 * `redirectToBouncePage` (ADR 0002 §3.4, RR parity): strip `id_token`, set
 * `shopify-reload=<path>?<params>`, `throw redirect()` to the bounce route.
 */
export function redirectToBouncePage(config: DerivedConfig, url: URL): never {
  const params = new URLSearchParams(url.search);
  params.delete('id_token');
  params.set('shopify-reload', `${url.pathname}${url.search}`);
  throw redirect({ href: `${config.auth.patchSessionTokenPath}?${params.toString()}` });
}
