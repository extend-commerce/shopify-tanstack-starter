/**
 * ADR 0010 4 — `authGuard` + `hydrateRouterContext` (the two `beforeLoad` guards
 * that replace the inline `_authenticated.tsx` / `__root.tsx` bodies).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { isRedirect } from '@tanstack/react-router';

import { authGuard, createAuthGuard, hydrateRouterContext } from '../src/server/auth/guards';

function callGuard(args: Parameters<typeof authGuard>[0]): unknown {
  try {
    authGuard(args);
    return undefined;
  } catch (error) {
    return error;
  }
}

const location = {
  pathname: '/app/products',
  searchStr: '?embedded=1&shop=s.myshopify.com&host=abc&id_token=eyJ',
};

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe('authGuard', () => {
  it('passes through when context.isAuthenticated', () => {
    expect(callGuard({ context: { isAuthenticated: true }, location })).toBeUndefined();
  });

  it('bounces to <authPathPrefix>/session-token, strips id_token, sets shopify-reload', () => {
    const error = callGuard({ context: { isAuthenticated: false }, location });
    expect(isRedirect(error)).toBe(true);

    const href = (error as { options: { href: string } }).options.href;
    expect(href.startsWith('/auth/session-token?')).toBe(true);

    const params = new URLSearchParams(href.split('?')[1]);
    expect(params.has('id_token')).toBe(false);
    expect(params.get('shopify-reload')).toBe(`${location.pathname}${location.searchStr}`);
    // host / shop / embedded preserved so App Bridge can re-init on the bounce page.
    expect(params.get('shop')).toBe('s.myshopify.com');
    expect(params.get('host')).toBe('abc');
    expect(params.get('embedded')).toBe('1');
  });

  it('short-circuits (no bounce) when window.shopify is initialised mid-session', () => {
    (globalThis as { window?: unknown }).window = { shopify: { config: { shop: 's' } } };
    expect(callGuard({ context: { isAuthenticated: false }, location })).toBeUndefined();
  });

  it('createAuthGuard({ authPathPrefix }) changes the bounce target', () => {
    const guard = createAuthGuard({ authPathPrefix: '/shopify-auth' });
    let error: unknown;
    try {
      guard({ context: { isAuthenticated: false }, location });
    } catch (e) {
      error = e;
    }
    expect(
      (error as { options: { href: string } }).options.href.startsWith(
        '/shopify-auth/session-token?',
      ),
    ).toBe(true);
  });
});

describe('hydrateRouterContext', () => {
  const ssrShop = 'hydrate-shop.myshopify.com';

  it('copies { shop, isAuthenticated } out of serverContext.shopify (SSR path)', () => {
    const out = hydrateRouterContext({
      context: { shop: '', isAuthenticated: false },
      serverContext: { shopify: { shop: ssrShop, isAuthenticated: true, session: 'SECRET' } },
    });
    expect(out).toEqual({ shop: ssrShop, isAuthenticated: true });
    // Only the two client-safe fields — never `session` / `sessionToken`.
    expect(Object.keys(out).sort()).toEqual(['isAuthenticated', 'shop']);
  });

  it('trusts App Bridge on the client re-run (no serverContext) instead of dropping to false', () => {
    (globalThis as { window?: unknown }).window = {
      shopify: { config: { shop: 'from-appbridge' } },
    };
    const out = hydrateRouterContext({
      context: { shop: 'seed', isAuthenticated: false },
      serverContext: undefined,
    });
    expect(out).toEqual({ shop: 'from-appbridge', isAuthenticated: true });
  });

  it('falls back to the router-context seed when neither serverContext nor App Bridge is present', () => {
    const out = hydrateRouterContext({
      context: { shop: 'seed', isAuthenticated: false },
      serverContext: undefined,
    });
    expect(out).toEqual({ shop: 'seed', isAuthenticated: false });
  });
});
