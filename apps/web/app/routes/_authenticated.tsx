import { useEffect } from 'react';
import { Outlet, createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { QueryClientProvider } from '@tanstack/react-query';

/**
 * The pathless embedded-auth UX gate (ADR 0006 §route structure / IP-6). This is
 * the ONLY auth gate — not per-route checks. The eager global `requestMiddleware`
 * (ADR 0002) never throws for missing auth; this layout does the bounce.
 */
export const Route = createFileRoute('/_authenticated')({
  beforeLoad: ({ context, location }) => {
    if (!context.isAuthenticated) {
      // Bounce to the App Bridge `session-token` reload (ADR 0002). `/auth/$`
      // (a server route) renders the `shopify-reload` HTML that re-enters with a
      // fresh token; `?shopify-reload=<path>` carries the return path. `href`
      // (not `to`) because `/auth/*` is a server route, outside the client route
      // tree, and the string must pass through verbatim.
      throw redirect({
        href: `/auth/session-token?shopify-reload=${encodeURIComponent(
          location.pathname + location.searchStr,
        )}`,
      });
    }
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const { queryClient } = Route.useRouteContext();
  const navigate = useNavigate();

  // `<s-link>` clicks inside `<s-app-nav>` emit `shopify:navigate`; route them
  // through TanStack Router so there is no iframe reload. This is the ported RR
  // `AppProvider` behaviour (ADR 0006 §navigation). Do NOT put a router `<Link>`
  // inside the nav — its `aria-current` triggers an App Bridge warning.
  useEffect(() => {
    const onNavigate = (event: Event) => {
      const href = (event.target as Element | null)?.getAttribute?.('href');
      if (href) {
        event.preventDefault();
        void navigate({ href });
      }
    };
    document.addEventListener('shopify:navigate', onNavigate);
    return () => document.removeEventListener('shopify:navigate', onNavigate);
  }, [navigate]);

  return (
    <QueryClientProvider client={queryClient}>
      {/*
        `<s-app-nav>` projects into the admin sidebar embedded and highlights the
        active item (ENG-2335). Plain `<s-link href>` children — pure `polaris.js`
        web components, no React binding. `rel="home"` marks the home item.
      */}
      <s-app-nav>
        <s-link href="/app" rel="home">
          Home
        </s-link>
        <s-link href="/app/additional">Additional</s-link>
      </s-app-nav>

      {/* Raw `<Outlet/>` — no `<Page>` wrapper (ADR 0006); pages own their `<s-page>`. */}
      <Outlet />
    </QueryClientProvider>
  );
}
