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
import { createAuthenticate, type Authenticate } from './authenticate';
import { addDocumentResponseHeaders as addDocumentResponseHeadersImpl } from './auth/headers';
import { createAuthHandler, type AuthRouteHandler } from './routes/auth-splat';
import { createUnauthenticated, type Unauthenticated } from '../unauthenticated';
import { bindWebhookHandlers, type WebhookFactory } from '../webhooks/index';
import { bindRegisterWebhooks } from '../webhooks/register';

/**
 * IP-3 — the `createShopifyApp(config)` return object (ADR 0001 return value,
 * ADR 0010 1 adds `authenticate`).
 *
 * The middleware + handler factories are the starter's primary style:
 *   - `requestMiddleware` — eager global; registered in the app's `src/start.ts`
 *   - `adminMiddleware`   — function middleware; attached to Admin `createServerFn`s
 *   - `handlers.{auth,webhooks}` — mounted as server routes
 *   - `unauthenticated.*`, `registerWebhooks`, `addDocumentResponseHeaders`
 *
 * `authenticate.*` (ADR 0010 1) is the equal-status RR-parity facade over the
 * same engine — `authenticate.<surface>` is the single implementation each
 * middleware adapts. Every method takes an explicit `Request`, server-side only.
 */
export interface ShopifyApp {
  api: Shopify;
  sessionStorage: SessionStorage;
  requestMiddleware: ReturnType<typeof createRequestMiddleware>;
  adminMiddleware: ReturnType<typeof createAdminMiddleware>;
  authenticate: Authenticate;
  unauthenticated: Unauthenticated;
  registerWebhooks: (args: { session: Session }) => Promise<unknown>;
  addDocumentResponseHeaders: (shop?: string) => void;
  handlers: {
    webhooks: WebhookFactory;
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

  const unauthenticated = createUnauthenticated(internals);

  return {
    api,
    sessionStorage: config.sessionStorage,
    requestMiddleware: createRequestMiddleware(internals),
    adminMiddleware: createAdminMiddleware(internals),
    authenticate: createAuthenticate({ internals, unauthenticated }),
    unauthenticated,
    registerWebhooks: bindRegisterWebhooks(api),
    addDocumentResponseHeaders: (shop) => addDocumentResponseHeadersImpl(api, shop),
    handlers: {
      // IP-8 seam: pre-bind WS4's factory with the offline-session resolver so
      // webhook deliveries never build an Admin client (ADR 0004).
      webhooks: bindWebhookHandlers({
        api,
        ensureValidOfflineSession: unauthenticated.ensureValidOfflineSession,
      }),
      auth: createAuthHandler(internals),
    },
    config: derivedConfig,
  };
}
