/**
 * Node runtime adapter (ADR 0009 runtime-adapter family).
 *
 * Import once, for effect, at the top of the consumer's `src/start.ts`:
 *
 *   import 'shopify-app-tanstack-start/adapters/node';
 *
 * It (1) registers Node's `crypto` / `fetch` / `base64` implementations into
 * `@shopify/shopify-api`'s global runtime table and (2) sets the runtime string.
 * The package's own code additionally imports `@shopify/shopify-api/adapters/web-api`
 * at baseline for Web Crypto — this module is additive, not a replacement.
 *
 * Documented-but-unshipped siblings (ADR 0009): `/adapters/web-api`, `/adapters/cf-worker`.
 */
// oxlint-disable-next-line import/no-unassigned-import -- adapter is imported for effect (RR parity)
import '@shopify/shopify-api/adapters/node';
import { setAbstractRuntimeString } from '@shopify/shopify-api/runtime';

setAbstractRuntimeString(() => 'TanStack Start (Node)');
