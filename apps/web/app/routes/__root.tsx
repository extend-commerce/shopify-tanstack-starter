import type { ReactNode } from 'react';
import { HeadContent, Scripts, createRootRouteWithContext } from '@tanstack/react-router';
import { hydrateRouterContext } from 'shopify-app-tanstack-start';
import type { ShopifyRouterContext } from 'shopify-app-tanstack-start';
// `/react` (IP-10) carries `useShopify()` AND — via its `import type
// './shopify-elements'` — the `declare module 'react'` shim that types the
// `<s-*>` custom elements under React 19's `React.JSX`. Importing anything from
// the module pulls the shim into the program.
import { useShopify } from 'shopify-app-tanstack-start/react';

const APP_BRIDGE_SRC = 'https://cdn.shopify.com/shopifycloud/app-bridge.js';
const POLARIS_SRC = 'https://cdn.shopify.com/shopifycloud/polaris.js';

export const Route = createRootRouteWithContext<ShopifyRouterContext>()({
  /**
   * `hydrateRouterContext` (ADR 0010 4) copies the two client-safe fields
   * `{ shop, isAuthenticated }` out of the SSR `serverContext.shopify` (the eager
   * `requestMiddleware` result — ADR 0002) into router context, where they
   * dehydrate for the browser. `session` / `sessionToken` never cross
   * (cross-cutting rule #4). It also owns the client re-run fallback (trust App
   * Bridge, don't drop `isAuthenticated` to `false` mid-session). No auth *logic*
   * here — the `_authenticated` layout owns the bounce. Using the package
   * accessor removes the `serverContext as …` cast this file used to carry
   * (ADR 0010 Implementation notes 5).
   */
  beforeLoad: hydrateRouterContext,
  loader: () => ({
    // Public client ID. Server-only read of the CLI-injected var — there is no
    // `VITE_` mirror (ADR 0008 env). `undefined` on the client; the value is
    // dehydrated from SSR loader data.
    apiKey: process.env.SHOPIFY_API_KEY ?? '',
  }),
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Shopify TanStack Starter' },
    ],
  }),
  shellComponent: RootDocument,
  errorComponent: RootErrorComponent,
  notFoundComponent: RootNotFound,
});

function RootDocument({ children }: { children: ReactNode }) {
  const { apiKey } = Route.useLoaderData();
  return (
    /*
     * `suppressHydrationWarning` on BOTH <html> and <head> is LOAD-BEARING
     * (ADR 0006 suppressHydrationWarning). `app-bridge.js` + `polaris.js` run
     * from <head> before React hydrates and mutate <head> and <body>
     * (`polaris.js` upgrades <s-page> and relocates its slotted children).
     * Without this, React 19's "won't be patched up" mismatch cascades and
     * effects in the whole tree never run — dead buttons, frozen panels
     * (prototype finding 5).
     */
    <html lang="en" suppressHydrationWarning>
      <head suppressHydrationWarning>
        {/*
          App Bridge contract (ADR 0006 head) — three LITERAL, non-async tags,
          in this order, BEFORE <HeadContent />:
            1. <meta shopify-api-key> parsed before app-bridge.js executes
            2. app-bridge.js render-blocking (no async) so window.shopify exists
               before hydration
            3. app-bridge.js before polaris.js (App Bridge warns otherwise)
          Do NOT move these into head({ scripts }) — <HeadContent /> reorders
          them ahead of a late <meta> and drops the non-async guarantee, which
          silently kills App Bridge init (no window.shopify, no Bearer).
        */}
        <meta name="shopify-api-key" content={apiKey} />
        <script src={APP_BRIDGE_SRC} />
        <script src={POLARIS_SRC} />
        <HeadContent />
      </head>
      <body suppressHydrationWarning>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

/**
 * `polaris.js` is a plain <head> script independent of `app-bridge.js` and runs
 * before any route render, so `<s-*>` chrome is always available in an error UI
 * (ADR 0006 error boundary / IP-1). App Bridge is GUARDED, not banned: the usual
 * failure cases (loader throw, render error, server 500) happen in a fully
 * authenticated embedded session where `window.shopify` is present — but this UI
 * must still render when the failure *is* App Bridge init, so every
 * `window.shopify` touch sits behind a feature check (`useShopify()` returns
 * `undefined` when it is absent).
 */
function RootErrorComponent({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : 'Something went wrong.';
  const shopify = useShopify();

  if (shopify) {
    try {
      shopify.toast.show(message, { isError: true });
    } catch {
      /* App Bridge present but toast unavailable — the <s-*> UI below still renders. */
    }
  }

  return (
    <s-page heading="Something went wrong">
      <s-section heading="Error">
        <s-paragraph>{message}</s-paragraph>
      </s-section>
    </s-page>
  );
}

function RootNotFound() {
  return (
    <s-page heading="Not found">
      <s-section>
        <s-paragraph>The page you are looking for does not exist.</s-paragraph>
      </s-section>
    </s-page>
  );
}
