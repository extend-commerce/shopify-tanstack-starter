import type { Session, Shopify } from '@shopify/shopify-api';
import type { SessionStorage } from '@shopify/shopify-app-session-storage';
import {
  deriveApi,
  deriveConfig,
  type AppConfigArg,
  type DerivedConfig,
  type ShopifyAppInternals,
} from './config';
import { createRequestMiddleware } from './auth/request-middleware';
import { createAdminMiddleware } from './auth/admin-middleware';
import { addDocumentResponseHeaders as addDocumentResponseHeadersImpl } from './auth/headers';
import { createAuthHandler, type AuthRouteHandler } from './routes/auth-splat';
import { createUnauthenticated, type Unauthenticated } from '../unauthenticated';
import {
  createWebhookHandlers,
  type WebhookHandlers,
  type WebhookRouteHandler,
} from '../webhooks/index';

/**
 * IP-3 — the `createShopifyApp(config)` return object (ADR 0001 §return value).
 *
 * Middleware + handler factories, NOT a port of RR's `authenticate.*` shape:
 *   - `requestMiddleware` — eager global; registered in the app's `src/start.ts`
 *   - `adminMiddleware`   — function middleware; attached to Admin `createServerFn`s
 *   - `handlers.{auth,webhooks}` — mounted as server routes
 *   - `unauthenticated.*`, `registerWebhooks`, `addDocumentResponseHeaders`
 */
export interface ShopifyApp {
  api: Shopify;
  sessionStorage: SessionStorage;
  requestMiddleware: ReturnType<typeof createRequestMiddleware>;
  adminMiddleware: ReturnType<typeof createAdminMiddleware>;
  unauthenticated: Unauthenticated;
  registerWebhooks: (args: { session: Session }) => Promise<unknown>;
  addDocumentResponseHeaders: (shop?: string) => void;
  handlers: {
    webhooks: (handlers: WebhookHandlers) => WebhookRouteHandler;
    auth: AuthRouteHandler;
  };
  config: DerivedConfig;
}

export function createShopifyApp(config: AppConfigArg): ShopifyApp {
  const api = deriveApi(config);
  const derivedConfig = deriveConfig(config);
  const internals: ShopifyAppInternals = {
    api,
    sessionStorage: config.sessionStorage,
    config: derivedConfig,
  };

  return {
    api,
    sessionStorage: config.sessionStorage,
    requestMiddleware: createRequestMiddleware(internals),
    adminMiddleware: createAdminMiddleware(internals),
    unauthenticated: createUnauthenticated(internals),
    registerWebhooks: ({ session }) => api.webhooks.register({ session }),
    addDocumentResponseHeaders: (shop) => addDocumentResponseHeadersImpl(api, shop),
    handlers: {
      // WS4 owns the real `createWebhookHandlers`; the merge takes its version.
      webhooks: (handlers) => createWebhookHandlers(internals, handlers),
      auth: createAuthHandler(internals),
    },
    config: derivedConfig,
  };
}
