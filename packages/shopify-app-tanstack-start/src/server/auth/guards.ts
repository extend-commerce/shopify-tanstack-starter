/**
 * Package-owned `beforeLoad` guards (ADR 0010 4, amends ADR 0002).
 *
 * These move the two pieces of auth control flow that used to live inline in the
 * app (`_authenticated.tsx` + `__root.tsx`) into the package so app code carries
 * none. Both are **`beforeLoad`-shaped** — isomorphic, no explicit `Request` —
 * and are spread into the app's route `beforeLoad` (the app keeps only the choice
 * of which route to gate).
 */
import { bounceToSessionToken } from './bounce';
import type { ShopifyRequestContext } from './request-middleware';

/** The client-safe subset the guards read from router context. */
interface GuardRouterContext {
  shop?: string;
  isAuthenticated?: boolean;
}

/** The `beforeLoad` arg shape `authGuard` consumes (subset of TanStack's). */
export interface AuthGuardArgs {
  context: GuardRouterContext;
  location: { pathname: string; searchStr: string };
}

export interface AuthGuardOptions {
  /** Auth route prefix — defaults to `/auth` (matches `deriveConfig`'s default). */
  authPathPrefix?: string;
}

/**
 * `authGuard` (ADR 0010 4) — the pathless `_authenticated` layout `beforeLoad`
 * body. Owns the unauthenticated bounce.
 *
 *  - On the CLIENT, App Bridge being initialised (`window.shopify`) means the
 *    frame is embedded and can mint fresh tokens — never bounce mid-session
 *    (that would tear down the subtree on every `router.invalidate()`).
 *  - `context.isAuthenticated` → allowed through.
 *  - otherwise: strip `id_token`, set `shopify-reload=<path>`, and
 *    `throw redirect({ href: '<authPathPrefix>/session-token?…' })`. `/auth/*` is
 *    a server route outside the client route tree, hence `href` not `to`.
 */
export function createAuthGuard(options: AuthGuardOptions = {}) {
  const patchSessionTokenPath = `${options.authPathPrefix ?? '/auth'}/session-token`;
  return function authGuard({ context, location }: AuthGuardArgs): void {
    // On the CLIENT, App Bridge being initialised means the frame is embedded and
    // can mint fresh tokens — never bounce mid-session. (Local cast, not the
    // ambient `Window.shopify`, so the guard is usable without importing `/react`.)
    if (typeof window !== 'undefined' && (window as { shopify?: unknown }).shopify) return;
    if (context.isAuthenticated) return;
    bounceToSessionToken({
      pathname: location.pathname,
      search: location.searchStr,
      patchSessionTokenPath,
    });
  };
}

/** Default `authGuard` (prefix `/auth`). Consumers with a custom `authPathPrefix`
 *  use `createAuthGuard({ authPathPrefix })`. */
export const authGuard = createAuthGuard();

/** The `beforeLoad` arg shape `hydrateRouterContext` consumes (subset of TanStack's). */
export interface HydrateRouterContextArgs {
  context: GuardRouterContext;
  /** TanStack Start's SSR server context. Untyped in the pinned router-core
   *  (`serverContext` is not a member of `BeforeLoadContextOptions`), so this is
   *  the typed accessor — see ADR 0010 Implementation notes. */
  serverContext?: unknown;
}

/** What `hydrateRouterContext` returns into router context (client-safe). */
export interface HydratedShopifyContext {
  shop: string;
  isAuthenticated: boolean;
}

/**
 * `hydrateRouterContext` (ADR 0010 4) — the `__root` `beforeLoad` job of copying
 * `{ shop, isAuthenticated }` out of the SSR `serverContext.shopify` into router
 * context, where it dehydrates for the browser. `session` / `sessionToken` must
 * NEVER cross (cross-cutting rule #4).
 *
 * `serverContext` is absent when this re-runs on the CLIENT (a
 * `router.invalidate()` after a mutation, or any nav that revalidates the root).
 * The base router context still holds the SSR seed (`shop: ''`,
 * `isAuthenticated: false`), so we must NOT fall back to it — that would drop
 * `isAuthenticated` to `false` mid-session and bounce a working embedded app.
 * Instead trust App Bridge: if `window.shopify` is initialised the frame is
 * embedded and the fetch interceptor + `adminMiddleware` retry keep tokens fresh.
 */
export function hydrateRouterContext({
  context,
  serverContext,
}: HydrateRouterContextArgs): HydratedShopifyContext {
  const ssr = (serverContext as { shopify?: ShopifyRequestContext } | undefined)?.shopify;
  if (ssr) {
    return { shop: ssr.shop ?? '', isAuthenticated: ssr.isAuthenticated };
  }
  const appBridge =
    typeof window !== 'undefined'
      ? (window as { shopify?: { config?: { shop?: string } } }).shopify
      : undefined;
  if (appBridge) {
    return { shop: appBridge.config?.shop ?? context.shop ?? '', isAuthenticated: true };
  }
  return { shop: context.shop ?? '', isAuthenticated: context.isAuthenticated ?? false };
}
