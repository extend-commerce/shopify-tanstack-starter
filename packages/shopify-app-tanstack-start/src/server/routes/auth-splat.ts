import type { ShopifyAppInternals } from '../config';
import { renderAppBridge } from '../auth/bounce';
import { buildLoginUrl } from '../auth/install-url';

/** Context a TanStack server-route handler passes (`{ request, params }`). */
export interface AuthRouteHandlerContext {
  request: Request;
  params?: { _splat?: string };
}

export type AuthRouteHandler = (ctx: AuthRouteHandlerContext) => Promise<Response>;

/**
 * `/auth/$` handler factory (ADR 0002 / ADR 0007), exposed as
 * `shopify.handlers.auth`. WS7 mounts it as a server route on `GET`/`POST`.
 *
 * Sub-paths (relative to `authPathPrefix`):
 *   - `session-token` (and bare `/auth`) → App Bridge `shopify-reload` bounce HTML
 *   - `exit-iframe`                      → App Bridge `window.open(_top)` HTML
 *   - `login`                           → UNUSED escape hatch → managed-install URL
 *   - anything else, non-embedded       → `api.auth.getEmbeddedAppUrl` redirect
 *
 * There is NO shop-domain login page (ADR 0007).
 */
export function createAuthHandler(internals: ShopifyAppInternals): AuthRouteHandler {
  const { api, config } = internals;

  return async function authHandler({ request }: AuthRouteHandlerContext): Promise<Response> {
    const url = new URL(request.url);
    const prefix = config.auth.path;
    const rest = (
      url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) : url.pathname
    )
      .replace(/^\/+/, '')
      .toLowerCase();
    const shop = url.searchParams.get('shop') ?? undefined;

    if (rest === 'exit-iframe') {
      const redirectTo = url.searchParams.get('exitIframe') ?? config.appUrl;
      return renderAppBridge(api, config, { shop, redirectTo });
    }

    if (rest === 'login') {
      // Unused escape hatch (ADR 0007) — the starter app never routes here.
      if (!shop) return new Response('Missing ?shop', { status: 400 });
      return new Response(null, {
        status: 302,
        headers: { location: buildLoginUrl(config, shop) },
      });
    }

    if (rest === 'session-token' || rest === '') {
      return renderAppBridge(api, config, { shop });
    }

    // Non-embedded document request → redirect to the Shopify Admin embedded URL.
    if (url.searchParams.get('embedded') !== '1') {
      try {
        const embeddedUrl = await api.auth.getEmbeddedAppUrl({ rawRequest: request });
        return new Response(null, { status: 302, headers: { location: embeddedUrl } });
      } catch {
        return renderAppBridge(api, config, { shop });
      }
    }

    return renderAppBridge(api, config, { shop });
  };
}
