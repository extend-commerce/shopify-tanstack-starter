import type { QueryClient } from '@tanstack/react-query';

/**
 * The client-safe router context (ADR 0003 3 / IP-6-ctx).
 *
 * This is the ONLY Shopify-derived context that reaches the browser. It is
 * populated during SSR from the global `requestMiddleware` result and dehydrated
 * by the app's `__root` `beforeLoad`. It MUST NEVER hold a `Session`, an access
 * token, or a session token — those stay in server-function / middleware context
 * (cross-cutting rule #4).
 *
 * Consumed by the app's `createRootRouteWithContext<ShopifyRouterContext>()`.
 */
export interface ShopifyRouterContext {
  shop: string;
  isAuthenticated: boolean;
  queryClient: QueryClient;
}
