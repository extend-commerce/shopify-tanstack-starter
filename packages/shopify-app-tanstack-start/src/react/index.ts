/**
 * The `shopify-app-tanstack-start/react` entry (IP-10 / ADR 0006 §package `/react`).
 *
 * Exactly two shell-universal items:
 *   1. A `React.JSX` shim `.d.ts` for the `<s-*>` custom elements + an `<s-link rel>`
 *      patch. Importing this module loads `./shopify-elements`, whose
 *      `declare module 'react'` augmentation then applies for the consumer.
 *   2. `useShopify()` — an SSR-safe accessor for the typed `window.shopify`.
 *
 * NO `<Page>` wrapper, NO head helper, NO provider component. The head stack is
 * three literal lines the app owns in `__root.tsx` (ADR 0006 §head).
 */
import type { ShopifyGlobal } from './shopify-elements';

export type { ShopifyGlobal } from './shopify-elements';

/**
 * Returns the App Bridge global, or `undefined` during SSR and before
 * `app-bridge.js` has initialised. Saves every call site re-writing the
 * `typeof window` guard.
 */
export function useShopify(): ShopifyGlobal | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { shopify?: ShopifyGlobal }).shopify;
}
