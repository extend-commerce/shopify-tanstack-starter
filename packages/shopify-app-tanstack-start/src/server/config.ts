import { shopifyApi, type ConfigParams, type Session, type Shopify } from '@shopify/shopify-api';
import type { SessionStorage } from '@shopify/shopify-app-session-storage';
import type { AdminApiContext } from '../clients/admin';
import { createMemoryAuthCoordinationStore, type AuthCoordinationStore } from './auth/coordination';

/**
 * Distribution model (ADR 0001 Consequences). `AppStore` (default) +
 * `SingleMerchant` are supported; `ShopifyAdmin` (merchant-custom-app strategy)
 * is out of scope and throws.
 */
export enum AppDistribution {
  AppStore = 'app_store',
  SingleMerchant = 'single_merchant',
  ShopifyAdmin = 'shopify_admin',
}

/** Passed to `hooks.afterAuth` once per session token after a successful exchange. */
export interface AfterAuthContext {
  session: Session;
  admin: AdminApiContext;
}

/**
 * `createShopifyApp` config (ADR 0001 Config object).
 *
 * Keeps React Router's `AppConfigArg` field *names* (low switching cost from the
 * RR template) but drops the legacy-OAuth `begin`/`callback` surface,
 * `restResources`, and `isCustomStoreApp`.
 */
export interface AppConfigArg {
  /** App client ID. Required for token exchange + managed-install URLs. */
  apiKey?: string;
  /** App client secret. */
  apiSecretKey: string;
  /** Public app URL; parsed to `hostName` / `hostScheme` for `@shopify/shopify-api`. */
  appUrl: string;
  /** A single dated Admin API version (cross-cutting rule #7 — NOT `LATEST_API_VERSION`). */
  apiVersion: string;
  /** Access scopes. Optional under Shopify managed installation. */
  scopes?: string[];
  /** The `@shopify/shopify-app-session-storage` persistence seam (IP-2). */
  sessionStorage: SessionStorage;
  /**
   * Cross-instance token-exchange / `afterAuth` coordination (ADR 0013).
   * Defaults to in-memory Maps (single-instance). Workers pass a KV-backed
   * store from `apps/web`; a future Redis impl is the same swap.
   */
  authCoordination?: AuthCoordinationStore;
  /** `AppStore` (default) or `SingleMerchant`. `ShopifyAdmin` throws (ADR 0001). */
  distribution?: AppDistribution;
  /** Auth route prefix. Defaults to `/auth`. */
  authPathPrefix?: string;
  hooks?: {
    /** Runs once (60s-TTL idempotent) after the first successful token exchange for a session token. */
    afterAuth?: (ctx: AfterAuthContext) => void | Promise<void>;
  };
  future?: {
    /** Opt into expiring offline access tokens + the `api.auth.refreshToken` path. */
    expiringOfflineAccessTokens?: boolean;
  };
  /** Billing plan map — contract reserved (ADR 0003); helpers are unimplemented. */
  billing?: Record<string, unknown>;
  logger?: ConfigParams['logger'];
  userAgentPrefix?: string;
  isTesting?: boolean;
  /**
   * IP-7 — the global `requestMiddleware` path-exclusion list (values owned by
   * WS7, ADR 0007). Each entry is matched against the request pathname:
   *
   *   - `'/foo'`   → exact match only
   *   - `'/foo/*'` → `/foo` itself and any `/foo/...` subpath
   *   - `'/foo*'`  → any pathname starting with `/foo`
   *
   * WS7 supplies `['/', '/auth', '/auth/*', '/webhooks/*']`. A request whose path
   * matches is skipped entirely by the eager auth pipeline (it still renders, just
   * without a loaded session). Load-bearing: a public route not listed here is
   * forced through embedded auth and cannot serve an unauthenticated request.
   */
  excludePaths?: string[];
}

/** Derived auth paths (RR parity; `callbackPath` is unused by the token-exchange strategy). */
export interface DerivedAuthPaths {
  path: string;
  callbackPath: string;
  patchSessionTokenPath: string;
  exitIframePath: string;
  loginPath: string;
}

export interface DerivedConfig extends AppConfigArg {
  distribution: AppDistribution;
  auth: DerivedAuthPaths;
  future: NonNullable<AppConfigArg['future']>;
  excludePaths: string[];
  authCoordination: AuthCoordinationStore;
}

/** Internal handle threaded through middleware / handlers / clients. */
export interface ShopifyAppInternals {
  api: Shopify;
  sessionStorage: SessionStorage;
  config: DerivedConfig;
}

function assertDistributionSupported(distribution: AppConfigArg['distribution']): void {
  if (distribution === AppDistribution.ShopifyAdmin) {
    throw new Error(
      'shopify-app-tanstack-start: AppDistribution.ShopifyAdmin (merchant-custom-app strategy) is out of scope (ADR 0001). Use AppStore or SingleMerchant.',
    );
  }
}

/** `deriveConfig` — normalise the user config + derive the auth paths (RR `deriveConfig`). */
export function deriveConfig(config: AppConfigArg): DerivedConfig {
  assertDistributionSupported(config.distribution);
  const prefix = config.authPathPrefix ?? '/auth';
  return {
    ...config,
    distribution: config.distribution ?? AppDistribution.AppStore,
    future: config.future ?? {},
    excludePaths: config.excludePaths ?? [],
    authCoordination: config.authCoordination ?? createMemoryAuthCoordinationStore(),
    auth: {
      path: prefix,
      callbackPath: `${prefix}/callback`,
      patchSessionTokenPath: `${prefix}/session-token`,
      exitIframePath: `${prefix}/exit-iframe`,
      loginPath: `${prefix}/login`,
    },
  };
}

/**
 * `deriveApi` — build the `@shopify/shopify-api` instance (RR `deriveApi`):
 * `appUrl` → `hostName` / `hostScheme`, force `isEmbeddedApp: true`.
 */
export function deriveApi(config: AppConfigArg): Shopify {
  assertDistributionSupported(config.distribution);
  const url = new URL(config.appUrl);
  return shopifyApi({
    apiKey: config.apiKey ?? '',
    apiSecretKey: config.apiSecretKey,
    apiVersion: config.apiVersion as ConfigParams['apiVersion'],
    scopes: config.scopes,
    hostName: url.host,
    hostScheme: (url.protocol.replace(':', '') || 'https') as 'http' | 'https',
    isEmbeddedApp: true,
    isCustomStoreApp: false,
    logger: config.logger,
    userAgentPrefix: config.userAgentPrefix,
    isTesting: config.isTesting,
    future: config.future as ConfigParams['future'],
  });
}

/** IP-7 matcher — see `AppConfigArg.excludePaths` for the semantics. */
export function isPathExcluded(pathname: string, rules: readonly string[]): boolean {
  return rules.some((rule) => {
    if (rule.endsWith('/*')) {
      const base = rule.slice(0, -2);
      return pathname === base || pathname.startsWith(`${base}/`);
    }
    if (rule.endsWith('*')) return pathname.startsWith(rule.slice(0, -1));
    return pathname === rule;
  });
}
