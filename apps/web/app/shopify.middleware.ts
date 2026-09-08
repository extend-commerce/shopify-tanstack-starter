/**
 * Client-safe handles for the two Shopify middlewares (ADR 0010 3).
 *
 * `~/shopify.server` builds the `createShopifyApp` instance at module scope — it
 * pulls in SQLite / D1 and the runtime adapter via `~/platform`, so it must never
 * enter the client bundle. `start.ts` (a client entry) still needs the global
 * `requestMiddleware`, and every `createServerFn` caller file needs
 * `adminMiddleware` — and a `createServerFn().middleware([...])` argument is NOT
 * stripped from the client build.
 *
 * `defineShopifyMiddleware` (from the client-safe `/middleware` entry) owns the
 * `createMiddleware` husk + the dynamic import + delegation to the package's real
 * request middleware / `authenticate.admin`; the returned middlewares carry
 * `{ shopify: ShopifyRequestContext }` / `AdminMiddlewareContext` with zero `as`
 * casts here.
 *
 * The `() => import('~/shopify.server')` module loader is wrapped in
 * `createIsomorphicFn().server(...)` so the Start compiler strips the
 * `~/shopify.server` specifier (and its SQLite / adapter graph) from the
 * CLIENT bundle — a bare thunk passed straight to `defineShopifyMiddleware(...)`
 * is a module-scope argument the compiler does NOT strip, and import-protection
 * rejects the build (ADR 0010 Implementation notes 3 — the deferred
 * thunk-as-argument leak check). The `.client()` branch never runs: nothing
 * client-side calls these middlewares' `.server()` bodies.
 */
import { createIsomorphicFn } from '@tanstack/react-start';
import { defineShopifyMiddleware } from 'shopify-app-tanstack-start/middleware';

const loadServerModule = createIsomorphicFn()
  .server(() => import('~/shopify.server'))
  .client(() => {
    throw new Error('shopify.middleware: server module loaded on the client');
  });

export const { requestMiddleware, adminMiddleware } = defineShopifyMiddleware(loadServerModule);
