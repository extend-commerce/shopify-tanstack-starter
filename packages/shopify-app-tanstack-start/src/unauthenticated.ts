import type { Session } from '@shopify/shopify-api';
import type { ShopifyAppInternals } from './server/config';
import { WITHIN_MILLISECONDS_OF_EXPIRY } from './server/auth/token-exchange';
import { createAdminApiContext, type AdminApiContext } from './clients/admin';
import { createStorefrontApiContext, type StorefrontApiContext } from './clients/storefront';

/** Thrown by `unauthenticated.*` when a shop has no stored offline session (RR parity). */
export class SessionNotFoundError extends Error {
  constructor(shop: string) {
    super(`shopify-app-tanstack-start: no offline session found for shop "${shop}"`);
    this.name = 'SessionNotFoundError';
  }
}

export interface Unauthenticated {
  admin: (shop: string) => Promise<{ session: Session; admin: AdminApiContext }>;
  storefront: (shop: string) => Promise<{ session: Session; storefront: StorefrontApiContext }>;
  /**
   * The offline-session resolver behind `admin`/`storefront`, exposed so
   * `createShopifyApp` can hand it to the webhook factory (IP-8) without building
   * an Admin client per delivery. Throws `SessionNotFoundError` when the shop has
   * no usable offline session (the webhook factory catches that → `session:
   * undefined`).
   */
  ensureValidOfflineSession: (shop: string) => Promise<Session>;
}

/**
 * `unauthenticated.admin(shop)` / `.storefront(shop)` (ADR 0003 §2). Offline
 * access with no session token — callers are webhook handlers, cron, app proxy.
 *
 * `ensureValidOfflineSession(shop)`: `loadSession(getOfflineId(shop))`, refresh
 * if near expiry (only when `future.expiringOfflineAccessTokens` + a refresh
 * token), `SessionNotFoundError` if there is no usable session.
 */
export function createUnauthenticated(internals: ShopifyAppInternals): Unauthenticated {
  const { api, sessionStorage, config } = internals;

  async function ensureValidOfflineSession(shop: string): Promise<Session> {
    const sanitized = api.utils.sanitizeShop(shop, true) ?? shop;
    const session = await sessionStorage.loadSession(api.session.getOfflineId(sanitized));
    if (!session?.accessToken) {
      throw new SessionNotFoundError(sanitized);
    }
    if (
      config.future.expiringOfflineAccessTokens &&
      session.refreshToken &&
      !session.isActive(undefined, WITHIN_MILLISECONDS_OF_EXPIRY)
    ) {
      const refreshed = await api.auth.refreshToken({
        shop: sanitized,
        refreshToken: session.refreshToken,
      });
      await sessionStorage.storeSession(refreshed.session);
      return refreshed.session;
    }
    return session;
  }

  return {
    ensureValidOfflineSession,
    admin: async (shop: string) => {
      const session = await ensureValidOfflineSession(shop);
      return { session, admin: createAdminApiContext(session, config.apiVersion) };
    },
    storefront: async (shop: string) => {
      const session = await ensureValidOfflineSession(shop);
      return {
        session,
        storefront: createStorefrontApiContext(api, session, config.apiVersion),
      };
    },
  };
}
