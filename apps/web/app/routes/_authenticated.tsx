import { useEffect } from 'react';
import { Outlet, createFileRoute, useNavigate } from '@tanstack/react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { authGuard } from 'shopify-app-tanstack-start';

/**
 * The pathless embedded-auth UX gate (ADR 0006 route structure / IP-6). This is
 * the ONLY auth gate — not per-route checks. The eager global `requestMiddleware`
 * (ADR 0002) never throws for missing auth; this layout does the bounce.
 *
 * `authGuard` (ADR 0010 4) owns that bounce: the `window.shopify` mid-session
 * short-circuit, the `context.isAuthenticated` pass-through, and — otherwise —
 * the `id_token` strip + `throw redirect()` to `/auth/session-token`. The app
 * keeps only the choice of which route to gate.
 */
export const Route = createFileRoute('/_authenticated')({
  beforeLoad: authGuard,
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const { queryClient } = Route.useRouteContext();
  const navigate = useNavigate();

  // `<s-link>` clicks inside `<s-app-nav>` emit `shopify:navigate`; route them
  // through TanStack Router so there is no iframe reload. This is the ported RR
  // `AppProvider` behaviour (ADR 0006 navigation). Do NOT put a router `<Link>`
  // inside the nav — its `aria-current` triggers an App Bridge warning.
  //
  // Use `navigate({ to })` and do NOT `preventDefault()` — the ENG-2335
  // prototype verified this does a clean SPA transition with no iframe reload;
  // `navigate({ href })` and/or `preventDefault()` here make every nav a slow
  // full-document round-trip through the dev tunnel.
  useEffect(() => {
    const onNavigate = (event: Event) => {
      const href = (event.target as Element | null)?.getAttribute?.('href');
      if (href) {
        void navigate({ to: href });
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
        <s-link href="/app/proxy-demo">App proxy</s-link>
      </s-app-nav>

      {/* Raw `<Outlet/>` — no `<Page>` wrapper (ADR 0006); pages own their `<s-page>`. */}
      <Outlet />
    </QueryClientProvider>
  );
}
