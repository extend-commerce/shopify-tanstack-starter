import { createRouter } from '@tanstack/react-router';
import { QueryClient } from '@tanstack/react-query';
import type { ShopifyRouterContext } from 'shopify-app-tanstack-start';
import { routeTree } from './routeTree.gen';

/**
 * Factory — TanStack Start calls this once per request (fresh instance, no
 * cross-request state). Seeds the client-safe router context (ADR 0003 3): only
 * `{ shop, isAuthenticated, queryClient }` ever reaches the browser — never a
 * `session` or access token. `shop` / `isAuthenticated` are overwritten by
 * `__root`'s `beforeLoad` from the SSR request-middleware result.
 */
export function getRouter() {
  const queryClient = new QueryClient();

  return createRouter({
    routeTree,
    context: {
      queryClient,
      shop: '',
      isAuthenticated: false,
    } satisfies ShopifyRouterContext,
    scrollRestoration: true,
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
  });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
