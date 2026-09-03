import type { DetailedHTMLProps, HTMLAttributes } from 'react';

/**
 * IP-10 — the `React.JSX.IntrinsicElements` shim for the Polaris CDN web
 * components (`<s-*>`) and App Bridge's `<s-app-nav>` (ADR 0006 package `/react`).
 *
 * `@shopify/app-bridge-types` declares its custom elements on the **legacy global
 * `JSX` namespace** (`declare global { namespace JSX { … } }`), which React 19's
 * `react-jsx` runtime does NOT read — it resolves intrinsic elements against
 * `React.JSX` (i.e. `namespace JSX` inside `declare module 'react'`). So
 * `<s-app-nav>` / `<s-link>` are otherwise untyped (TS2339).
 *
 * This is the dependency-free fallback: loose props (any attribute) for every
 * `s-*` tag, plus an explicit `<s-link>` that adds the `rel` attribute App
 * Bridge's `<s-app-nav>` uses (`<s-link rel="home">`) — `@shopify/polaris-types`
 * omits it. When `@shopify/polaris-types` IS installed it supplies precise
 * per-element types on the same namespace; keep only one of the two to avoid a
 * duplicate-identifier clash on `s-link`.
 */
type SElementProps = DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
  [attribute: string]: unknown;
};

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      [element: `s-${string}`]: SElementProps;
      's-link': SElementProps & {
        href?: string;
        rel?: string;
        target?: string;
        download?: boolean;
      };
      's-app-nav': SElementProps;
    }
  }
}

/**
 * The App Bridge global (`window.shopify`). Minimal shape covering the surface the
 * starter shell touches; `[key: string]` keeps it open. A consumer wanting the
 * full type installs `@shopify/app-bridge-types` (not resolvable here, so this
 * local interface is the shipped fallback — ADR 0010 5).
 */
export interface ShopifyGlobal {
  config: { apiKey?: string; shop?: string; host?: string; locale?: string };
  idToken: () => Promise<string>;
  toast: {
    show: (message: string, options?: { duration?: number; isError?: boolean }) => void;
    hide: () => void;
  };
  loading: (isLoading: boolean) => void;
  [key: string]: unknown;
}

/**
 * IP-10 / ADR 0010 5 — the shipped ambient `window.shopify` type. Pulled into a
 * consumer's program by importing anything from `shopify-app-tanstack-start/react`
 * (same mechanism as the `<s-*>` JSX shim above), so app code touches
 * `window.shopify` with **zero `as` casts**.
 */
declare global {
  interface Window {
    shopify?: ShopifyGlobal;
  }
}
