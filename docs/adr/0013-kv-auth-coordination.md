# KV-backed token-exchange de-dupe and afterAuth idempotency

**Amends [ADR 0002](0002-auth-boundary-and-bounce-control-flow.md)** (the in-memory
Maps). Closes ADR 0009's documented single-instance limitation for the Workers
target.

Decision: ENG-2369.

## Decision

1. **What KV holds** (one namespace, binding `AUTH_KV`):
   - `inflight:{shop}` → `"1"`, TTL ~15s — hint that an isolate is mid-exchange.
   - `afterauth:{sessionToken}` → `"1"`, TTL 60s — same keying as today's Map
     (`runAfterAuthOnce` keyed on the session token, not the shop).
2. **Race semantics.** KV is eventually consistent and has no atomic NX. A
   get-then-put guard is **best-effort**, matching the original in-memory
   guarantee (also best-effort, just per-process). Residual double-fire across
   isolates is accepted. Strict serialization = Durable Object, parked in fog.
3. **Where the code lives.**
   - A tiny runtime-agnostic `AuthCoordinationStore` on `createShopifyApp` config
     (default: in-memory, today's Maps). Not Cloudflare-specific; a future Redis
     `SETNX` is another impl. This is the minimum package change that lets the
     app swap the store without copying `token-exchange.ts`.
   - The KV impl is in `apps/web/app/auth/coordination.kv.ts`. Cloudflare glue
     stays in the app.
   - Local Node keeps the memory impl (ADR 0017).
4. **In-isolate Map stays as a fast path** even on Workers (promise-sharing for
   concurrent requests in one isolate). KV is the cross-isolate layer.
5. **`unauthenticated.*` / `scopes.*`** do not use these Maps. Only the eager
   token-exchange path in `ensureAuthenticatedOfflineSession` does.

## Why

- The map forbade a new package Lock interface *during the build map*. The
  deploy map has to replace the call sites; an optional config object is smaller
  than forking middleware into the app.
- KV over Durable Objects: standing preference for the most minimal
  implementation. The starter's `afterAuth` is a no-op; best-effort is enough.

## Considered and rejected

- **Copy `requestMiddleware` into `apps/web` to avoid a package seam.** Duplicates
  the auth engine.
- **Durable Object lock as the default.** Correctness upgrade if someone puts
  non-idempotent work in `hooks.afterAuth`; not needed for the starter.
- **Two KV namespaces.** One is enough; key prefixes separate the concerns.

## Consequences

- `AppConfigArg` gains optional `authCoordination?: AuthCoordinationStore`.
- Workers `shopify.server.ts` (via `platform.cf.ts`) passes the KV store.
- ADR 0009's "do not add a seam" sentence is superseded for this effort only.
