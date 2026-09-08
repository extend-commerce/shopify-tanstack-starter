/**
 * KV-backed `AuthCoordinationStore` (ADR 0013). Workers only — imported from
 * `platform.cf.ts`. In-isolate de-dupe still uses the memory store (promise
 * sharing); KV is the cross-isolate layer.
 *
 * KV `expirationTtl` minimum is 60 seconds, so in-flight hints cannot be
 * shorter than the afterAuth TTL.
 */
import { env } from 'cloudflare:workers';
import {
  AFTER_AUTH_TTL_MS,
  createMemoryAuthCoordinationStore,
  type AuthCoordinationStore,
} from 'shopify-app-tanstack-start';

const local = createMemoryAuthCoordinationStore();
/** Cloudflare KV rejects TTLs under 60s. */
const KV_MIN_TTL_SEC = 60;

export function createKvAuthCoordinationStore(): AuthCoordinationStore {
  return {
    runExclusive(shop, work) {
      return local.runExclusive(shop, async () => {
        const key = `inflight:${shop}`;
        try {
          await env.AUTH_KV.put(key, '1', { expirationTtl: KV_MIN_TTL_SEC });
          return await work();
        } finally {
          await env.AUTH_KV.delete(key);
        }
      });
    },
    async claimAfterAuth(key, ttlMs = AFTER_AUTH_TTL_MS) {
      const kvKey = `afterauth:${key}`;
      const seen = await env.AUTH_KV.get(kvKey);
      if (seen) return false;
      const ttl = Math.max(KV_MIN_TTL_SEC, Math.ceil(ttlMs / 1000));
      await env.AUTH_KV.put(kvKey, '1', { expirationTtl: ttl });
      return true;
    },
  };
}
