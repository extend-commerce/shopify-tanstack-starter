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
 * IP-4 — the Admin server-fn context. Built by `authenticate.admin(request)`
 * (ADR 0010 1, the single implementation) and spread verbatim into
 * `adminMiddleware`'s `next({ context })`. Server-only; `billing` is reserved.
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

/**
 * `authenticate.admin(request)` (ADR 0010 1) — the **single implementation** of
 * the Admin data boundary (ADR 0002 layer 2). Independently re-validates the
 * request's `Bearer` (App Bridge's fetch interceptor puts it on server-fn RPC
 * too — prototype finding 6), reloads / ensures an active offline session, and
 * builds the `admin` client. On an Admin API `401` the wrapped `.graphql` (which
 * now resolves a `Response`, ADR 0010 2) invalidates the stored token and throws
 * the retry response (`401` + `X-Shopify-Retry-Invalid-Session-Request: 1`) so
 * App Bridge retries.
 *
 * Callable server-side only, with an explicit `Request`. `adminMiddleware` is a
 * thin adapter over this (no parallel code path).
 */
export async function authenticateAdmin(
  internals: ShopifyAppInternals,
  request: Request,
): Promise<AdminMiddlewareContext> {
  const { api, sessionStorage, config } = internals;
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

  const base = createAdminApiContext(api, session, config.apiVersion);
  const admin: AdminApiContext = {
    // Wrap `.graphql` so an Admin API 401 (now surfaced as `res.status === 401`,
    // ADR 0010 2) invalidates the token and throws the retry response instead of
    // handing back the raw 401 `Response`.
    graphql: (async (...args: Parameters<AdminApiContext['graphql']>) => {
      const res = await base.graphql(...args);
      if (res.status === 401) {
        session.accessToken = undefined;
        await sessionStorage.storeSession(session);
        throw respondToInvalidSessionToken({
          request,
          retry: true,
          bouncePath: config.auth.patchSessionTokenPath,
        });
      }
      return res;
    }) as AdminApiContext['graphql'],
  };

  return {
    admin,
    session,
    scopes: createScopesContext(internals, session, request),
    billing: createBillingContext(),
  };
}

/**
 * IP-4 — function middleware for Admin-touching `createServerFn`s. A **thin
 * adapter** over `authenticate.admin(request)` (ADR 0010 1): it resolves the
 * per-request `Request` and spreads the context into `next`.
 */
export function createAdminMiddleware(internals: ShopifyAppInternals) {
  return createMiddleware({ type: 'function' }).server(async ({ next }) =>
    next({ context: await authenticateAdmin(internals, getRequest()) }),
  );
}
