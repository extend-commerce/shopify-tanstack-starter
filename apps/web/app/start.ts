/**
 * Defining `app/start.ts` disables TanStack Start's automatic CSRF middleware, so
 * it is re-added here — scoped to server functions only, so Shopify's
 * cross-origin webhook / auth POSTs are never Origin-checked (ADR 0002 / ENG-2321
 * / BUILD-PLAN 6 rule 6). Webhooks are server routes, not server fns.
 *
 * The Shopify `requestMiddleware` (the eager global auth pipeline, ADR 0002) runs
 * after CSRF for every SSR + server-route request whose path is not on
 * `excludePaths` (IP-7). It never throws for missing auth — the pathless
 * `_authenticated` layout owns the bounce.
 *
 * `start.ts` is a client entry too (TanStack Start bundles it for both
 * environments), so it must NOT statically import `~/shopify.server` — that
 * module pulls in SQLite / the runtime adapter via `~/platform` and is blocked by
 * import-protection in the client graph. Instead the delegating `.server()`
 * callback below dynamically imports it; the compiler strips `.server()` bodies
 * (and that dynamic import with them) from the client bundle.
 */
import { createStart, createCsrfMiddleware } from '@tanstack/react-start';

import { requestMiddleware } from '~/shopify.middleware';

const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === 'serverFn',
});

export const startInstance = createStart(() => ({
  requestMiddleware: [csrfMiddleware, requestMiddleware],
}));
