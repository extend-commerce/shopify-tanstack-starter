import { defineConfig } from 'vitest/config';

/**
 * Contract tests for the `shopify-app-tanstack-start` public surface (ADR 0010 /
 * ENG-2360 done-when — NOT the broader ENG-2361 unit suite).
 *
 * `node` environment: the package is runtime-agnostic Web `Request`/`Response`
 * code; the guard tests stub `globalThis.window` themselves. The package is
 * consumed as JIT TypeScript source, so Vitest transforms `src/**` directly — no
 * build step.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
