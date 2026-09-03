import { createFileRoute } from '@tanstack/react-router';
import { AppProxyLink, AppProxyProvider } from 'shopify-app-tanstack-start/react';

/**
 * `/app/proxy-demo` (ADR 0010 7) — a static page showing `AppProxyProvider` /
 * `AppProxyLink` from `shopify-app-tanstack-start/react`. No Admin API calls.
 *
 * In a real app these render on an **App Proxy route** (served under the
 * storefront domain — see `app/routes/proxy/$.ts`), not inside the embedded
 * admin: `AppProxyProvider` drops a `<base href={appUrl}>` so the proxied page
 * loads its JS/CSS from the app origin, and `AppProxyLink` rewrites a
 * root-relative `href` to an absolute, trailing-slashed URL. Here `appUrl` is the
 * app's own origin, so the example is inert but demonstrates the API.
 */
export const Route = createFileRoute('/_authenticated/app/proxy-demo')({
  // Server-only read of the CLI-injected var (same pattern as `__root`'s
  // `apiKey`): `undefined` on the client, dehydrated from SSR loader data.
  loader: () => ({
    appUrl: process.env.SHOPIFY_APP_URL ?? process.env.HOST ?? 'https://example.com',
  }),
  component: ProxyDemo,
});

function ProxyDemo() {
  const { appUrl } = Route.useLoaderData();

  return (
    <s-page heading="App proxy helpers">
      <s-section heading="AppProxyProvider / AppProxyLink">
        <s-paragraph>
          These components come from <s-text>shopify-app-tanstack-start/react</s-text>. On an App
          Proxy route (see <s-text>app/routes/proxy/$.ts</s-text>) wrap the page in{' '}
          <s-text>&lt;AppProxyProvider appUrl=&#123;appUrl&#125;&gt;</s-text> and use{' '}
          <s-text>&lt;AppProxyLink href="/proxy/other"&gt;</s-text> for links between proxied
          routes.
        </s-paragraph>

        <AppProxyProvider appUrl={appUrl}>
          <s-paragraph>
            Example link (rewritten to an absolute, trailing-slashed URL by the provider):{' '}
            <AppProxyLink href="/proxy/other-route">Another proxied route</AppProxyLink>
          </s-paragraph>
        </AppProxyProvider>
      </s-section>
    </s-page>
  );
}
