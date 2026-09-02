import type { Shopify } from '@shopify/shopify-api';
import type { DerivedConfig } from '../config';
import { renderAppBridge } from './bounce';

/**
 * `renderExitIframe` (ADR 0002 §3.4, RR parity): App Bridge HTML that
 * `window.open`s the target `_top`, breaking out of the admin iframe. Used for
 * flows that must leave the embedded context (billing confirmation, OAuth-style
 * detours). The starter does not route here by default.
 */
export function renderExitIframe(
  api: Shopify,
  config: DerivedConfig,
  args: { shop?: string; redirectTo: string },
): Response {
  return renderAppBridge(api, config, { shop: args.shop, redirectTo: args.redirectTo });
}
