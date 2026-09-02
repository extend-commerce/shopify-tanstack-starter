import { createMiddleware } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import type { Session } from '@shopify/shopify-api';
import type { ShopifyAppInternals } from '../config';
import { ensureAuthenticatedOfflineSession, getSessionTokenFromRequest } from './token-exchange';
import { createAdminApiContext, type AdminApiContext } from '../../clients/admin';
import { respondToInvalidScopes, respondToInvalidSessionToken } from './headers';
import { buildScopesReauthorizeUrl } from './install-url';

/**
 * `scopes` capability (RR shape `{ query, request, revoke }`). Only `request` is
 * implemented — it throws the scope re-authorization response (ADR 0002 Failure
 * contract). `query` / `revoke` are reserved.
 */
export interface ScopesApiContext {
  request: (scopes: string[]) => Promise<never>;
  query: () => Promise<never>;
  revoke: (scopes: string[]) => Promise<never>;
}

/**
 * `billing` capability — contract RESERVED (ADR 0001 / ADR 0003). The shape is
 * fixed from the start; helpers are unimplemented.
 */
export interface BillingApiContext {
  require: (options?: unknown) => Promise<never>;
  check: (options?: unknown) => Promise<never>;
  request: (options?: unknown) => Promise<never>;
  cancel: (options?: unknown) => Promise<never>;
  createUsageRecord: (options?: unknown) => Promise<never>;
  updateUsageCappedAmount: (options?: unknown) => Promise<never>;
}

/**
 * IP-4 — the `adminMiddleware` server-fn context. Server-only; attached to every
 * `createServerFn` that touches the Admin API. `billing` is reserved.
 */
export interface AdminMiddlewareContext {
  admin: AdminApiContext;
  session: Session;
  scopes: ScopesApiContext;
  billing: BillingApiContext;
}

function createBillingContext(): BillingApiContext {
  const notImplemented = async (): Promise<never> => {
    // TODO(billing): wire `api.billing.*` (require / check / request / cancel /
    // createUsageRecord / updateUsageCappedAmount). Contract reserved — ADR 0003.
    throw new Error(
      'shopify-app-tanstack-start: billing helpers are not implemented yet (ADR 0003 reserved slot)',
    );
  };
  return {
    require: notImplemented,
    check: notImplemented,
    request: notImplemented,
    cancel: notImplemented,
    createUsageRecord: notImplemented,
    updateUsageCappedAmount: notImplemented,
  };
}

function createScopesContext(
  internals: ShopifyAppInternals,
  session: Session,
  request: Request,
): ScopesApiContext {
  return {
    request: async (scopes: string[]): Promise<never> => {
      throw respondToInvalidScopes({
        request,
        reauthorizeUrl: buildScopesReauthorizeUrl(internals.config, session.shop, scopes),
      });
    },
    // TODO(scopes): implement `query` / `revoke` via Admin GraphQL
    // `currentAppInstallation` (RR parity). Not needed by the starter.
    query: async (): Promise<never> => {
      throw new Error('shopify-app-tanstack-start: scopes.query is not implemented yet');
    },
    revoke: async (): Promise<never> => {
      throw new Error('shopify-app-tanstack-start: scopes.revoke is not implemented yet');
    },
  };
}

function isAdminUnauthorized(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as {
    status?: number;
    statusCode?: number;
    response?: { status?: number };
  };
  return (
    candidate.status === 401 || candidate.statusCode === 401 || candidate.response?.status === 401
  );
}

/**
 * IP-4 — function middleware for Admin-touching `createServerFn`s (ADR 0002
 * layer 2). Independently re-validates the request's `Bearer` (App Bridge's
 * fetch interceptor puts it on server-fn RPC too — prototype finding 6), reloads
 * / ensures an active offline session, builds the `admin` client, and on an
 * Admin API `401` invalidates the stored token and returns the retry response
 * (`401` + `X-Shopify-Retry-Invalid-Session-Request: 1`) so App Bridge retries.
 */
export function createAdminMiddleware(internals: ShopifyAppInternals) {
  const { api, sessionStorage, config } = internals;

  return createMiddleware({ type: 'function' }).server(async ({ next }) => {
    const request = getRequest();
    const url = new URL(request.url);

    const token = getSessionTokenFromRequest(request, url);
    if (!token) {
      throw respondToInvalidSessionToken({
        request,
        retry: true,
        bouncePath: config.auth.patchSessionTokenPath,
      });
    }

    let session: Session;
    try {
      const decoded = await api.session.decodeSessionToken(token);
      const shop = new URL(decoded.dest).hostname;
      session = await ensureAuthenticatedOfflineSession(internals, {
        sessionToken: token,
        decoded,
        shop,
      });
    } catch {
      throw respondToInvalidSessionToken({
        request,
        retry: true,
        bouncePath: config.auth.patchSessionTokenPath,
      });
    }

    if (!session.accessToken) {
      throw respondToInvalidSessionToken({
        request,
        retry: true,
        bouncePath: config.auth.patchSessionTokenPath,
      });
    }

    const base = createAdminApiContext(session, config.apiVersion);
    const admin: AdminApiContext = {
      // Wrap `.graphql` so an Admin API 401 invalidates the token and surfaces the
      // retry response instead of a raw error.
      graphql: ((...args: Parameters<AdminApiContext['graphql']>) =>
        base.graphql(...args).catch(async (error: unknown) => {
          if (isAdminUnauthorized(error)) {
            session.accessToken = undefined;
            await sessionStorage.storeSession(session);
            throw respondToInvalidSessionToken({
              request,
              retry: true,
              bouncePath: config.auth.patchSessionTokenPath,
            });
          }
          throw error;
        })) as AdminApiContext['graphql'],
    };

    return next({
      context: {
        admin,
        session,
        scopes: createScopesContext(internals, session, request),
        billing: createBillingContext(),
      } satisfies AdminMiddlewareContext,
    });
  });
}
