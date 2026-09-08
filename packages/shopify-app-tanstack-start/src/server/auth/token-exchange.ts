import { RequestedTokenType, type JwtPayload, type Session } from '@shopify/shopify-api';
import type { ShopifyAppInternals } from '../config';
import { createAdminApiContext } from '../../clients/admin';
import { AFTER_AUTH_TTL_MS } from './coordination';

/** RR's expiry slack: `session.isActive(undefined, WITHIN_MILLISECONDS_OF_EXPIRY)`. */
export const WITHIN_MILLISECONDS_OF_EXPIRY = 5 * 60 * 1000;

/** Session token from `Authorization: Bearer <jwt>` (App Bridge fetch) or `?id_token` (first load / bounce reload). */
export function getSessionTokenFromRequest(request: Request, url: URL): string | undefined {
  const auth = request.headers.get('authorization');
  if (auth && auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(auth.indexOf(' ') + 1).trim();
  }
  return url.searchParams.get('id_token') ?? undefined;
}

/* ------------------------------------------------------------------------- *
 * Token-exchange coordination (ADR 0013).
 *
 * Default is the in-memory `AuthCoordinationStore` (per `createShopifyApp`
 * instance). Workers pass a KV-backed store from `apps/web`. Do not put
 * Cloudflare types in this file.
 * ------------------------------------------------------------------------- */

/**
 * The eager token-exchange / refresh pipeline (ADR 0002 Auth boundary).
 *
 * Given a validated session token + its shop: load the offline session and — if
 * it is missing, tokenless, or within `WITHIN_MILLISECONDS_OF_EXPIRY` of expiry —
 * refresh (expiring-offline path) or run token exchange, store the result, and
 * fire `hooks.afterAuth` once. Concurrent requests for one shop share one
 * in-flight promise. NEVER throws for "not authenticated" — it throws only on a
 * genuine Shopify/exchange error, which callers translate to the failure contract.
 */
export async function ensureAuthenticatedOfflineSession(
  internals: ShopifyAppInternals,
  args: { sessionToken: string; decoded: JwtPayload; shop: string },
): Promise<Session> {
  const { api, sessionStorage, config } = internals;
  const { sessionToken, shop } = args;
  const coordination = config.authCoordination;

  const sessionId = api.session.getOfflineId(shop);
  const existing = await sessionStorage.loadSession(sessionId);
  const isFresh =
    Boolean(existing?.accessToken) && existing!.isActive(undefined, WITHIN_MILLISECONDS_OF_EXPIRY);
  if (isFresh) return existing as Session;

  return coordination.runExclusive(shop, async () => {
    let session: Session;
    if (config.future.expiringOfflineAccessTokens && existing?.refreshToken) {
      const refreshed = await api.auth.refreshToken({
        shop,
        refreshToken: existing.refreshToken,
      });
      session = refreshed.session;
    } else {
      const exchanged = await api.auth.tokenExchange({
        sessionToken,
        shop,
        requestedTokenType: RequestedTokenType.OfflineAccessToken,
        expiring: config.future.expiringOfflineAccessTokens,
      });
      session = exchanged.session;
    }

    await sessionStorage.storeSession(session);

    const claimed = await coordination.claimAfterAuth(sessionToken, AFTER_AUTH_TTL_MS);
    if (claimed && config.hooks?.afterAuth) {
      await config.hooks.afterAuth({
        session,
        admin: createAdminApiContext(session, config.apiVersion),
      });
    }

    return session;
  });
}
