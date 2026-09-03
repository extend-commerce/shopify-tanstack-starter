/**
 * `shopify-app-tanstack-start/middleware` — the **client-safe** middleware entry
 * (ADR 0010 3).
 *
 * `~/shopify.server` builds the `createShopifyApp` instance at module scope — it
 * pulls in `pg` + the Node `@shopify/shopify-api` adapter, so it must never enter
 * the client bundle (import-protection blocks the server-file glob and `node:`
 * built-ins there). But `start.ts` (a client entry) needs the global
 * `requestMiddleware`, and every `createServerFn` caller file needs
 * `adminMiddleware` — and a `createServerFn().middleware([...])` argument is NOT
 * stripped from the client build (only `.handler()` / `.validator()` are).
 *
 * `defineShopifyMiddleware(loadServerModule)` builds the two `createMiddleware`
 * shells here, in a module that imports **no** server-only code at module scope
 * (oxlint `no-restricted-imports` enforces no `node:*`). Each shell's `.server()`
 * body — which the compiler strips from the client bundle, dynamic imports and
 * all — `await`s `loadServerModule()` and either delegates to the real request
 * middleware's own `.options.server` (which preserves its `{ shopify }` output
 * type) or calls `authenticate.admin(request)` directly (the single
 * implementation `adminMiddleware` adapts — ADR 0010 1). The result is generically
 * typed against the package's own `ShopifyApp` types, so the returned middleware
 * carry `{ shopify: ShopifyRequestContext }` / `AdminMiddlewareContext` with
 * **zero `as never` / `as unknown` casts** in the app or the package.
 *
 * // TODO(app-phase): verify the () => import() thunk-as-arg does not leak into
 * // the client bundle (a literal `import()` inside `.server()` is a known-safe
 * // spot; passing the thunk as an argument must land in a tree-shaken region —
 * // ADR 0010 3 implementation note, matches TanStack issues #2783 / #6185).
 */
import { createMiddleware } from '@tanstack/react-start';
import type { ShopifyApp } from '../server/shopify-app';

/**
 * The server-only surface `loadServerModule` must resolve. `() => import('~/shopify.server')`
 * satisfies it structurally: `~/shopify.server` re-exports `requestMiddleware`
 * (for its `{ shopify }` output type) and `authenticate` (for the cast-free
 * admin-context type) off the `createShopifyApp` return.
 */
export interface ShopifyServerModule {
  requestMiddleware: ShopifyApp['requestMiddleware'];
  authenticate: ShopifyApp['authenticate'];
}

/** What `defineShopifyMiddleware` returns — the two client-safe middleware husks,
 *  typed exactly like the package's real middleware. */
export interface ShopifyMiddleware {
  requestMiddleware: ShopifyApp['requestMiddleware'];
  adminMiddleware: ShopifyApp['adminMiddleware'];
}

export function defineShopifyMiddleware(
  loadServerModule: () => Promise<ShopifyServerModule>,
): ShopifyMiddleware {
  const requestMiddleware = createMiddleware({ type: 'request' }).server(async (options) => {
    const mod = await loadServerModule();
    const server = mod.requestMiddleware.options.server;
    if (!server) {
      throw new Error(
        'shopify-app-tanstack-start/middleware: loaded requestMiddleware has no .options.server',
      );
    }
    // Delegate straight through: `options` (with `next` / `request`) already
    // matches the real request middleware's server-fn options, and its return
    // type carries `{ shopify: ShopifyRequestContext }` unchanged (request
    // middleware `.options.server` preserves `TServerContext`).
    return server(options);
  });

  const adminMiddleware = createMiddleware({ type: 'function' }).server(async ({ next }) => {
    const [{ getRequest }, mod] = await Promise.all([
      import('@tanstack/react-start/server'),
      loadServerModule(),
    ]);
    // `authenticate.admin` is the single Admin implementation `adminMiddleware`
    // adapts (ADR 0010 1); calling it here keeps the husk's output type inferred
    // as `AdminMiddlewareContext` with no cast (function-middleware
    // `.options.server` would erase it to `unknown`).
    return next({ context: await mod.authenticate.admin(getRequest()) });
  });

  return { requestMiddleware, adminMiddleware };
}
