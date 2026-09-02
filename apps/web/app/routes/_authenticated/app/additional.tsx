import { createFileRoute } from '@tanstack/react-router';

/**
 * `/app/additional` (ADR 0007 §route tree). Static Polaris web-component content.
 * Exists to demo `<s-app-nav>` active-state highlighting + client-side
 * `shopify:navigate` routing through TanStack Router (no iframe reload). No Admin
 * API calls.
 */
export const Route = createFileRoute('/_authenticated/app/additional')({
  component: Additional,
});

function Additional() {
  return (
    <s-page heading="Additional page">
      <s-section heading="Nothing to see here">
        <s-paragraph>
          This page is a navigation-demo target. Selecting it in the app nav routes client-side via
          the <s-text>shopify:navigate</s-text> listener in the authenticated layout — the embedded
          iframe never reloads.
        </s-paragraph>
        <s-paragraph>
          Replace it with your own content, or delete it and its <s-text>&lt;s-link&gt;</s-text> in{' '}
          <s-text>_authenticated.tsx</s-text>.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}
