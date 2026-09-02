/**
 * Client-safe handles for the two Shopify middlewares.
 *
 * `~/shopify.server` builds the `createShopifyApp` instance at module scope — it
 * pulls in `pg` and the Node `@shopify/shopify-api` adapter, so it must never
 * enter the client bundle (import-protection blocks the server-file glob and
 * `node:` built-ins there). But `start.ts` (a client entry) needs the global
 * request middleware, and every `createServerFn` caller file needs
 * `adminMiddleware` — and a `createServerFn().middleware([...])` argument is NOT
 * stripped from the client build (only `.handler()` / `.validator()` are).
 *
 * So each middleware here is a thin `createMiddleware` shell whose `.server()`
 * body dynamically imports `~/shopify.server` and delegates to the package
 * middleware's own server handler (passing our `next` through so the delegate's
 * `next({ context })` becomes ours). The compiler strips `.server()` bodies (and
 * that dynamic import with them) from the client bundle, leaving only the
 * `createMiddleware` husk — all the client ever references. The explicit
 * `.server<...>()` context type re-declares what the delegate contributes
 * (`{ admin, session, scopes, billing }`, IP-4), which a dynamic import can't
 * infer, so it stays typed at the `createServerFn` call site.
 */
import { createMiddleware } from '@tanstack/react-start';
import type { AdminMiddlewareContext, ShopifyRequestContext } from 'shopify-app-tanstack-start';

export const requestMiddleware = createMiddleware({ type: 'request' }).server<{
  shopify: ShopifyRequestContext;
}>(async ({ next, ...rest }) => {
  const { shopify } = await import('~/shopify.server');
  return shopify.requestMiddleware.options.server!({ ...rest, next } as never) as never;
});

export const adminMiddleware = createMiddleware({
  type: 'function',
}).server<AdminMiddlewareContext>(async ({ next, ...rest }) => {
  const { shopify } = await import('~/shopify.server');
  return shopify.adminMiddleware.options.server!({ ...rest, next } as never) as never;
});
