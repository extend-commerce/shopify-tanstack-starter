/**
 * ADR 0010 3 + D — `defineShopifyMiddleware` client-safety, as a build-level
 * assertion (this replaces the manual "does the husk leak?" experiment).
 *
 * `pnpm --filter web build` must pass (import-protection would fail it if a
 * server-only graph — `~/shopify.server` and its SQLite / runtime-adapter /
 * Drizzle deps — reached the client via `shopify.middleware.ts` or via the `authGuard` /
 * `hydrateRouterContext` imports from the package's `.` entry), and the emitted
 * client assets must contain none of the server-only markers below.
 */
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(new URL(import.meta.url).pathname), '../../..');
const clientAssetsDir = join(repoRoot, 'apps/web/.output/public/assets');

interface Marker {
  label: string;
  hit: (content: string) => boolean;
}

const MARKERS: Marker[] = [
  {
    label: 'better-sqlite3',
    hit: (c) =>
      /(?:from|require\(|import\()\s*["']better-sqlite3["']/.test(c) || c.includes('better_sqlite3'),
  },
  { label: 'node:async_hooks', hit: (c) => c.includes('node:async_hooks') },
  { label: 'SHOPIFY_API_SECRET', hit: (c) => c.includes('SHOPIFY_API_SECRET') },
  { label: 'drizzle-orm', hit: (c) => c.includes('drizzle-orm') },
  { label: 'createShopifyApp', hit: (c) => c.includes('createShopifyApp') },
];

describe('defineShopifyMiddleware client-safety (build-level)', () => {
  it('the web client bundle carries no server-only markers', { timeout: 180_000 }, () => {
    execSync('pnpm --filter web build', {
      cwd: repoRoot,
      stdio: 'pipe',
      env: { ...process.env, CI: '1' },
    });

    const files = readdirSync(clientAssetsDir).filter((f) => f.endsWith('.js'));
    expect(files.length).toBeGreaterThan(0);

    const violations: string[] = [];
    for (const file of files) {
      const content = readFileSync(join(clientAssetsDir, file), 'utf8');
      for (const marker of MARKERS) {
        if (marker.hit(content)) violations.push(`${file} :: ${marker.label}`);
      }
    }

    expect(
      violations,
      `server-only markers leaked into client assets:\n${violations.join('\n')}`,
    ).toEqual([]);
  });
});
