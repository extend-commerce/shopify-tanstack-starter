/**
 * `AppProxyProvider` + `AppProxyLink` (ADR 0010 7) — ported verbatim in behaviour
 * from `@shopify/shopify-app-react-router` **v2** (`react/components/AppProxyProvider`
 * + `react/components/AppProxyLink`).
 *
 * App-proxy pages render behind the storefront domain (e.g.
 * `https://<shop>/apps/<subpath>/`). Neither React Router nor TanStack rewrites
 * URLs, so a route rendering this must match the proxy pathname exactly and end
 * in a trailing slash. `AppProxyProvider` drops a `<base href={appUrl}>` so the
 * app's own JS/CSS load from the app origin, and exposes `formatUrl` (prefix the
 * request origin onto root-relative URLs, force a trailing slash). `AppProxyLink`
 * is an `<a>` that runs its `href` through `formatUrl`.
 *
 * Leaf components — `react` only, no server imports (keeps `src/**`
 * runtime-agnostic, ADR 0009). `window` is touched only inside `useEffect`.
 */
import type { AnchorHTMLAttributes, DetailedHTMLProps, ReactNode } from 'react';
import { createContext, forwardRef, useContext, useEffect, useState } from 'react';

/** Props for {@link AppProxyProvider}. */
export interface AppProxyProviderProps {
  /** The URL where the app is hosted — e.g. `process.env.SHOPIFY_APP_URL`. */
  appUrl: string;
  /** The children to render. */
  children?: ReactNode;
}

type FormatUrlFunction = (url: string | undefined, addOrigin?: boolean) => string | undefined;

interface AppProxyProviderContextProps {
  appUrl: string;
  formatUrl: FormatUrlFunction;
  requestUrl?: URL;
}

export const AppProxyProviderContext = createContext<AppProxyProviderContextProps | null>(null);

/**
 * Sets up a page to render behind a Shopify app proxy so its JavaScript and CSS
 * load from the app origin. Call `authenticate.public.appProxy(request)` in the
 * route's server handler first, then wrap the page in this provider with the
 * app URL.
 */
export function AppProxyProvider(props: AppProxyProviderProps) {
  const { children, appUrl } = props;
  const [requestUrl, setRequestUrl] = useState<URL | undefined>();

  // Deferred read of `window.location` (an external system): SSR + first client
  // render see `undefined` (matching markup), then the effect fills in the real
  // request URL. Reading it during render instead would hydration-mismatch.
  // oxlint-disable-next-line react/set-state-in-effect -- intentional SSR-safe deferred external read (RR parity)
  useEffect(() => setRequestUrl(new URL(window.location.href)), [setRequestUrl]);

  return (
    <AppProxyProviderContext.Provider
      value={{ appUrl, requestUrl, formatUrl: formatProxyUrl(requestUrl) }}
    >
      <base href={appUrl} />
      {children}
    </AppProxyProviderContext.Provider>
  );
}

function formatProxyUrl(requestUrl: URL | undefined): FormatUrlFunction {
  return (url: string | undefined, addOrigin = true) => {
    if (!url) {
      return url;
    }

    let finalUrl = url;

    if (addOrigin && requestUrl && finalUrl.startsWith('/')) {
      finalUrl = new URL(`${requestUrl.origin}${url}`).href;
    }
    if (!finalUrl.endsWith('/')) {
      finalUrl = `${finalUrl}/`;
    }

    return finalUrl;
  };
}

/** Props for {@link AppProxyLink} — every `<a>` attribute, with `href` required. */
export interface AppProxyLinkProps extends DetailedHTMLProps<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  HTMLAnchorElement
> {
  href: string;
}

/**
 * An `<a>` element that works when rendered behind an app proxy: its `href` is
 * run through the provider's `formatUrl` (origin prefix + trailing slash). Must
 * be used inside an {@link AppProxyProvider}.
 */
export const AppProxyLink = forwardRef<HTMLAnchorElement, AppProxyLinkProps>(
  function AppProxyLink(props, ref) {
    const context = useContext(AppProxyProviderContext);

    if (!context) {
      throw new Error('AppProxyLink must be used within an AppProxyProvider component');
    }

    const { children, href, ...otherProps } = props;

    return (
      <a href={context.formatUrl(href)} {...otherProps} ref={ref}>
        {children}
      </a>
    );
  },
);
