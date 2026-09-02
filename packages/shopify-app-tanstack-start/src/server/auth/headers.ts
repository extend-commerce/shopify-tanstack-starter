import { setResponseHeader } from '@tanstack/react-start/server';
import type { Shopify } from '@shopify/shopify-api';

/** App Bridge intercepts these response headers on XHR (RR parity). */
export const RETRY_INVALID_SESSION_HEADER = 'X-Shopify-Retry-Invalid-Session-Request';
export const REAUTHORIZE_URL_HEADER = 'X-Shopify-API-Request-Failure-Reauthorize-Url';

/**
 * Per-shop CSP `frame-ancestors` for document responses (ADR 0006 CSP).
 * Emitted from the global `requestMiddleware`, which is the only place with the
 * decoded `shop` on every document request. No `<link rel=preload>` for the CDN
 * scripts — they are already non-async in `__root`'s `<head>`.
 */
export function setDocumentCspForShop(api: Shopify, shop: string | undefined): void {
  const sanitized = shop ? api.utils.sanitizeShop(shop) : null;
  if (!sanitized) return;
  try {
    setResponseHeader(
      'Content-Security-Policy',
      `frame-ancestors https://${sanitized} https://admin.shopify.com;`,
    );
  } catch {
    // `setResponseHeader` throws outside a request context (e.g. unit tests) — ignore.
  }
}

/**
 * IP-9 — bound onto the `createShopifyApp` return as
 * `addDocumentResponseHeaders(shop?)`. RR's version also injects `Link` preload
 * headers for the CDN scripts; this one only sets the per-shop CSP `frame-ancestors`
 * (ADR 0006 drops the preload).
 */
export function addDocumentResponseHeaders(api: Shopify, shop?: string): void {
  setDocumentCspForShop(api, shop);
}

/** A document request has no Bearer, is not a server-fn RPC, and accepts HTML. */
export function isDocumentRequest(request: Request): boolean {
  if (request.headers.get('authorization')) return false;
  if (request.headers.get('x-tsr-serverfn')) return false;
  return (request.headers.get('accept') ?? '').includes('text/html');
}

/**
 * RR-exact failure contract (ADR 0002 Failure contract):
 *   - XHR  → `401` (+ `X-Shopify-Retry-Invalid-Session-Request: 1` when `retry`)
 *   - document → `302` to the bounce route
 */
export function respondToInvalidSessionToken(args: {
  request: Request;
  retry?: boolean;
  bouncePath?: string;
}): Response {
  const { request, retry = false, bouncePath = '/auth/session-token' } = args;
  if (isDocumentRequest(request)) {
    const url = new URL(request.url);
    const params = new URLSearchParams();
    params.set('shopify-reload', `${url.pathname}${url.search}`);
    return new Response(null, {
      status: 302,
      headers: { location: `${bouncePath}?${params.toString()}` },
    });
  }
  const headers = new Headers();
  if (retry) headers.set(RETRY_INVALID_SESSION_HEADER, '1');
  return new Response(null, { status: 401, headers });
}

/**
 * Scope re-authorization (ADR 0002 Failure contract):
 *   - XHR → `401` + `X-Shopify-API-Request-Failure-Reauthorize-Url`
 *   - document → `302` to the managed-install URL
 */
export function respondToInvalidScopes(args: {
  request: Request;
  reauthorizeUrl: string;
}): Response {
  const { request, reauthorizeUrl } = args;
  if (isDocumentRequest(request)) {
    return new Response(null, { status: 302, headers: { location: reauthorizeUrl } });
  }
  return new Response(null, {
    status: 401,
    headers: { [REAUTHORIZE_URL_HEADER]: reauthorizeUrl },
  });
}
