/**
 * IP-7 — the global-middleware path-exclusion list (ADR 0007 exclusion list).
 *
 * Owned by WS7 (app routes) because the package cannot know which of the app's
 * routes are public. The eager `requestMiddleware` (ADR 0002) SKIPS the eager
 * session-load / token-exchange for a request whose pathname matches one of
 * these; everything else flows through embedded auth.
 *
 * Matcher semantics (`isPathExcluded` in the package `config.ts`):
 *   - `'/'`          → exact match only (the `/` banner fallback needs no session)
 *   - `'/auth'`      → exact `/auth`
 *   - `'/auth/*'`    → `/auth` and any `/auth/...` subpath (the bounce handler)
 *   - `'/webhooks/*'`→ any `/webhooks/...` (HMAC-verified, no session token)
 *   - `'/proxy/*'`   → any `/proxy/...` (App Proxy — HMAC-verified via
 *                      `authenticate.public.appProxy`, storefront request, no
 *                      session token; ADR 0010 7)
 *
 * LOAD-BEARING: a new public route that is not added here is forced through the
 * embedded-auth boundary and cannot serve an unauthenticated request.
 */
export const EXCLUDE_PATHS = ['/', '/auth', '/auth/*', '/webhooks/*', '/proxy/*'] as const;
