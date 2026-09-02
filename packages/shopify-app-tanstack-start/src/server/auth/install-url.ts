import type { DerivedConfig } from '../config';

/**
 * Managed-installation URL builders (ADR 0002 §3.3, RR parity).
 * Managed install = `/admin/oauth/install?client_id=...`; after the merchant
 * installs, Admin loads the app embedded and token exchange mints the token.
 */

/** `scopes.request` target — `https://{shop}/admin/oauth/install?...` with optional scopes. */
export function buildScopesReauthorizeUrl(
  config: DerivedConfig,
  shop: string,
  scopes: string[],
): string {
  const url = new URL(`https://${shop}/admin/oauth/install`);
  if (config.apiKey) url.searchParams.set('client_id', config.apiKey);
  if (config.scopes?.length) url.searchParams.set('scope', config.scopes.join(','));
  if (scopes.length) url.searchParams.set('optional_scopes', scopes.join(','));
  return url.toString();
}

/** Generic managed-install URL for a shop. */
export function buildManagedInstallUrl(
  config: DerivedConfig,
  shop: string,
  scopes?: string[],
): string {
  const url = new URL(`https://${shop}/admin/oauth/install`);
  if (config.apiKey) url.searchParams.set('client_id', config.apiKey);
  const wanted = scopes ?? config.scopes;
  if (wanted?.length) url.searchParams.set('scope', wanted.join(','));
  return url.toString();
}

/**
 * `login` builder — the UNUSED escape hatch (ADR 0007). The starter app never
 * routes here (non-embedded hits fall back to the `/` banner). Kept for parity /
 * standalone-app forks.
 */
export function buildLoginUrl(config: DerivedConfig, shop: string): string {
  const handle = shop.replace(/\.myshopify\.com$/, '');
  const url = new URL(`https://admin.shopify.com/store/${handle}/oauth/install`);
  if (config.apiKey) url.searchParams.set('client_id', config.apiKey);
  return url.toString();
}
