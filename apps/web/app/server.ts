/**
 * Cloudflare Worker entry (ADR 0011).
 *
 * Wrangler resolves `main` as a filesystem path. `@tanstack/react-start/server-entry`
 * is a package export, so putting it in wrangler.jsonc makes deploy fail with
 * "entry-point file … was not found". This file is the on-disk entry; it re-exports
 * TanStack Start's fetch handler. Add `queue` / `scheduled` here later if needed.
 */
import handler from '@tanstack/react-start/server-entry';

export default {
  fetch: handler.fetch,
};
