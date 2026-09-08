// Workers D1 session client (ADR 0012). Loaded only from `platform.cf.ts`
// (CLOUDFLARE=1 Vite alias). Do not construct drizzle(env.DB) at module scope
// as a long-lived singleton — wrap per call; `env` is request-bound.

import { DrizzleSessionStorageSQLite } from '@shopify/shopify-app-session-storage-drizzle';
import type { SessionStorage } from '@shopify/shopify-app-session-storage';
import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';

import * as schema from './schema';

function getStorage(): SessionStorage {
  const db = drizzle(env.DB, { schema });
  return new DrizzleSessionStorageSQLite(db, schema.sessionTable as never);
}

export const sessionStorage: SessionStorage = {
  storeSession: (session) => getStorage().storeSession(session),
  loadSession: (id) => getStorage().loadSession(id),
  deleteSession: (id) => getStorage().deleteSession(id),
  deleteSessions: (ids) => getStorage().deleteSessions(ids),
  findSessionsByShop: (shop) => getStorage().findSessionsByShop(shop),
};
