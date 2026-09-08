/**
 * The `shopify-app-tanstack-start` main (`.`) entry (ADR 0001 exports).
 *
 * `createShopifyApp(config)` + config helpers, the auth failure-contract
 * primitives, `unauthenticated.*`, the client-safe router-context type, the
 * capability clients, the version string, a thin `boundary` equivalent, and
 * curated re-exports from `@shopify/shopify-api`.
 */

export { createShopifyApp, type ShopifyApp } from './shopify-app';

export {
  AppDistribution,
  deriveApi,
  deriveConfig,
  isPathExcluded,
  type AppConfigArg,
  type DerivedConfig,
  type DerivedAuthPaths,
  type ShopifyAppInternals,
  type AfterAuthContext,
} from './config';

export {
  createMemoryAuthCoordinationStore,
  AFTER_AUTH_TTL_MS,
  type AuthCoordinationStore,
} from './auth/coordination';

export { WITHIN_MILLISECONDS_OF_EXPIRY } from './auth/token-exchange';

export {
  addDocumentResponseHeaders,
  setDocumentCspForShop,
  respondToInvalidSessionToken,
  respondToInvalidScopes,
  isDocumentRequest,
  RETRY_INVALID_SESSION_HEADER,
  REAUTHORIZE_URL_HEADER,
} from './auth/headers';

export { redirectToBouncePage, renderAppBridge, bounceToSessionToken } from './auth/bounce';
export { renderExitIframe } from './auth/exit-iframe';

// Package-owned `beforeLoad` guards (ADR 0010 4). The app phase replaces the
// inline `_authenticated.tsx` / `__root.tsx` bodies with these.
export { authGuard, createAuthGuard, hydrateRouterContext } from './auth/guards';
export type {
  AuthGuardArgs,
  AuthGuardOptions,
  HydrateRouterContextArgs,
  HydratedShopifyContext,
} from './auth/guards';
export {
  buildManagedInstallUrl,
  buildLoginUrl,
  buildScopesReauthorizeUrl,
} from './auth/install-url';

export { createAuthHandler } from './routes/auth-splat';
export type { AuthRouteHandler, AuthRouteHandlerContext } from './routes/auth-splat';

export type {
  ShopifyRequestContext,
  ShopifyRequestMiddlewareContext,
} from './auth/request-middleware';
export type {
  AdminMiddlewareContext,
  ScopesApiContext,
  BillingApiContext,
} from './auth/admin-middleware';
export { authenticateAdmin } from './auth/admin-middleware';

// The `authenticate.*` parity facade (ADR 0010 1). `createShopifyApp(...).authenticate`
// is the object; these are its per-surface context shapes.
export type {
  Authenticate,
  AdminContext,
  FlowContext,
  FulfillmentServiceContext,
  PosContext,
  CheckoutContext,
  AppProxyContext,
  AuthenticatePublicOptions,
  EnsureCORSFunction,
  LiquidResponseFunction,
} from './authenticate';

// Client-safe router context (WS3 / IP-6-ctx) — exported from the `.` entry too
// so WS5's `createRootRouteWithContext` can import it from the main path.
export type { ShopifyRouterContext } from '../context';

// Capability clients (also available at `shopify-app-tanstack-start/clients`).
export {
  createAdminApiContext,
  createStorefrontApiContext,
  type AdminApiContext,
  type StorefrontApiContext,
} from '../clients/index';

// `unauthenticated.*` + its error.
export {
  createUnauthenticated,
  SessionNotFoundError,
  type Unauthenticated,
} from '../unauthenticated';

// Webhook primitive + factory + types (ADR 0004 + ADR 0010 6; full surface at
// `shopify-app-tanstack-start/webhooks`).
export {
  createAuthenticateWebhook,
  createWebhookHandler,
  bindWebhookHandlers,
} from '../webhooks/index';
export { registerWebhooks, bindRegisterWebhooks } from '../webhooks/register';
export type {
  AuthenticateWebhook,
  WebhookHandler,
  WebhookHandlerMap,
  WebhookContext,
  WebhookRoute,
  WebhookFactory,
} from '../webhooks/index';

export { SHOPIFY_APP_TANSTACK_START_VERSION } from '../version';

/**
 * A thin `boundary` equivalent (RR familiarity). TanStack Start renders thrown
 * `Response`s natively and the root error boundary lives in the app (IP-1 / ADR
 * 0006), so this is intentionally minimal.
 */
export const boundary = {
  error(error: unknown): Response | undefined {
    return error instanceof Response ? error : undefined;
  },
  headers(init?: HeadersInit): Headers {
    return new Headers(init);
  },
};

// Curated re-exports from `@shopify/shopify-api` (RR parity).
export {
  LogSeverity,
  DeliveryMethod,
  BillingInterval,
  BillingReplacementBehavior,
  ApiVersion,
  Session,
} from '@shopify/shopify-api';
export type { JwtPayload, Shopify } from '@shopify/shopify-api';
