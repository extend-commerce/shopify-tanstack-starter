import { RequestedTokenType, type JwtPayload, type Session } from '@shopify/shopify-api';
import type { ShopifyAppInternals } from '../config';
import { createAdminApiContext } from '../../clients/admin';

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
 * Per-process idempotency + in-flight de-dupe.
 *
 * These are intentionally IN-MEMORY and NOT behind a seam (ADR 0009 Known
 * single-instance limitation). On multi-instance hosting two instances can each
 * run `hooks.afterAuth` once for the same shop inside the 60s TTL window. For the
 * starter's no-op handler this is harmless; the deferred deployment effort swaps
 * a shared lock (Durable Object / Redis SETNX / Postgres advisory lock) behind
 * these exact call sites. Do NOT add an abstraction here.
 * ------------------------------------------------------------------------- */
const inFlightByShop = new Map<string, Promise<Session>>();
const afterAuthSeen = new Map<string, number>();
const AFTER_AUTH_TTL_MS = 60 * 1000;

async function runAfterAuthOnce(key: string, fn: () => Promise<void> | void): Promise<void> {
  const now = Date.now();
  for (const [seenKey, expiresAt] of afterAuthSeen) {
    if (expiresAt <= now) afterAuthSeen.delete(seenKey);
  }
  if (afterAuthSeen.has(key)) return;
  afterAuthSeen.set(key, now + AFTER_AUTH_TTL_MS);
  await fn();
}

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

  const sessionId = api.session.getOfflineId(shop);
  const existing = await sessionStorage.loadSession(sessionId);
  const isFresh =
    Boolean(existing?.accessToken) && existing!.isActive(undefined, WITHIN_MILLISECONDS_OF_EXPIRY);
  if (isFresh) return existing as Session;

  const inFlight = inFlightByShop.get(shop);
  if (inFlight) return inFlight;

  const work = (async (): Promise<Session> => {
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

    await runAfterAuthOnce(sessionToken, async () => {
      if (config.hooks?.afterAuth) {
        await config.hooks.afterAuth({
          session,
          admin: createAdminApiContext(api, session, config.apiVersion),
        });
      }
    });

    return session;
  })();

  inFlightByShop.set(shop, work);
  try {
    return await work;
  } finally {
    inFlightByShop.delete(shop);
  }
}
