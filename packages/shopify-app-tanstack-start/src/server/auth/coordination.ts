import type { Session } from '@shopify/shopify-api';

/**
 * Cross-instance coordination for the eager token-exchange path (ADR 0013).
 *
 * Default impl is in-memory (today's Maps). Workers pass a KV-backed impl from
 * `apps/web`. The interface is runtime-agnostic — Cloudflare types do not appear
 * here. A future Redis `SETNX` store is another implementation of this, not a
 * new package seam.
 *
 * Semantics are **best-effort** on every impl. KV has no atomic NX; the original
 * Maps were per-process. Residual `afterAuth` double-fire is accepted. Strict
 * serialization is a Durable Object, parked.
 */
export interface AuthCoordinationStore {
  /**
   * Run `work` once per shop while an exchange is in flight. Concurrent callers
   * for the same shop share the same promise (in-isolate). Cross-isolate sharing
   * is best-effort and impl-defined.
   */
  runExclusive(shop: string, work: () => Promise<Session>): Promise<Session>;
  /**
   * Claim the right to run `hooks.afterAuth` for `key` (the session token)
   * inside `ttlMs`. Return `false` if another caller already claimed it.
   */
  claimAfterAuth(key: string, ttlMs: number): Promise<boolean>;
}

export const AFTER_AUTH_TTL_MS = 60 * 1000;

/**
 * Per-process Maps — the ADR 0002 behaviour, now an explicit default impl
 * rather than a hidden module singleton shared across `createShopifyApp` calls.
 */
export function createMemoryAuthCoordinationStore(): AuthCoordinationStore {
  const inFlightByShop = new Map<string, Promise<Session>>();
  const afterAuthSeen = new Map<string, number>();

  return {
    runExclusive(shop, work) {
      const existing = inFlightByShop.get(shop);
      if (existing) return existing;
      const pending = work().finally(() => {
        inFlightByShop.delete(shop);
      });
      inFlightByShop.set(shop, pending);
      return pending;
    },
    async claimAfterAuth(key, ttlMs = AFTER_AUTH_TTL_MS) {
      const now = Date.now();
      for (const [seenKey, expiresAt] of afterAuthSeen) {
        if (expiresAt <= now) afterAuthSeen.delete(seenKey);
      }
      if (afterAuthSeen.has(key)) return false;
      afterAuthSeen.set(key, now + ttlMs);
      return true;
    },
  };
}
