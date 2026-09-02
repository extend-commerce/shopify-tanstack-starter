/**
 * The `shopify-app-tanstack-start/clients` entry (ADR 0003 Split decision).
 *
 * Admin + Storefront capability factories together — NOT split further. The
 * client-safe router-context type is re-exported here too so a consumer can pull
 * everything context-related from one path.
 */
export { createAdminApiContext, type AdminApiContext } from './admin';
export {
  createStorefrontApiContext,
  type StorefrontApiContext,
  type StorefrontGraphqlResponse,
} from './storefront';
export type { ShopifyRouterContext } from '../context';
