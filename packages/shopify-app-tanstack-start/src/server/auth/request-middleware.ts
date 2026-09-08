import { createMiddleware } from '@tanstack/react-start';
import type { JwtPayload, Session } from '@shopify/shopify-api';
import { isPathExcluded, type ShopifyAppInternals } from '../config';
import { ensureAuthenticatedOfflineSession, getSessionTokenFromRequest } from './token-exchange';
import { setDocumentCspForShop } from './headers';

/**
 * What the global request middleware puts on the server-only middleware context
 * (ADR 0002). Reachable during SSR as `serverContext.shopify` on the
 * `beforeLoad` / `loader` args. The app's `__root` `beforeLoad` copies only
 * `{ shop, isAuthenticated }` from here into the dehydrated router context —
 * `session` / `sessionToken` NEVER cross to the client (cross-cutting rule #4).
 */
export interface ShopifyRequestContext {
  session: Session | undefined;
  shop: string | undefined;
  sessionToken: JwtPayload | undefined;
  isAuthenticated: boolean;
}

export interface ShopifyRequestMiddlewareContext {
  shopify: ShopifyRequestContext;
}

const EMPTY: ShopifyRequestContext = {
  session: undefined,
  shop: undefined,
  sessionToken: undefined,
  isAuthenticated: false,
};

/**
 * The eager global `requestMiddleware` (ADR 0002 Auth boundary), registered by
 * the consumer in `src/start.ts` via `createStart`. Runs for every SSR and
 * server-route request whose path is not on `config.excludePaths` (IP-7).
 *
 * It decodes any session token, loads the offline session, refreshes / exchanges
 * within the expiry buffer, and sets the per-shop document CSP. It is a
 * single choke point that cannot be forgotten — but it is NOT the per-call data
 * boundary (that is `adminMiddleware` on each Admin server fn) and it NEVER
 * throws for missing/invalid auth: the pathless `_authenticated` `beforeLoad`
 * owns the bounce.
 */
export function createRequestMiddleware(internals: ShopifyAppInternals) {
  const { api, config } = internals;

  return createMiddleware({ type: 'request' }).server(async ({ next, request }) => {
    const url = new URL(request.url);

    if (isPathExcluded(url.pathname, config.excludePaths)) {
      return next();
    }

    const token = getSessionTokenFromRequest(request, url);
    if (!token) {
      return next({ context: { shopify: { ...EMPTY } } });
    }

    try {
      const decoded = await api.session.decodeSessionToken(token);
      const shop = new URL(decoded.dest).hostname;
      setDocumentCspForShop(api, shop);

      const session = await ensureAuthenticatedOfflineSession(internals, {
        sessionToken: token,
        decoded,
        shop,
      });

      return next({
        context: {
          shopify: {
            session,
            shop,
            sessionToken: decoded,
            isAuthenticated: Boolean(session.accessToken),
          },
        },
      });
    } catch (error) {
      // Invalid / expired token, or a transient exchange failure. Do NOT throw —
      // the bounce is a `beforeLoad` concern (ADR 0002). An expired token that
      // slips past here is caught on the next `adminMiddleware` server-fn call.
      // Log so `wrangler tail` can distinguish "no token" from D1 / secret misses.
      console.error('shopify requestMiddleware: session token rejected', error);
      return next({ context: { shopify: { ...EMPTY } } });
    }
  });
}
