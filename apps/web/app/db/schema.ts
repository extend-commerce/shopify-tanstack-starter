// Verbatim copy of @shopify/shopify-app-session-storage-drizzle's canonical
// sqlite schema (v5.0.1 — src/schemas/sqlite.schema.ts). Re-diff on adapter
// bumps. The adapter does not export this or its table type
// (`SQLiteSessionTable`) — see ADR 0012.
//
// 17 columns, canonical camelCase SQL identifiers, SQL table name `session`.
// `expires` / `refreshTokenExpires` are ISO text; `userId` is blob/bigint;
// booleans are integer. No columns added or removed: associated-user +
// expiring-offline-token columns stay even though offline-only auth (ADR 0002)
// leaves them null.

import { blob, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const sessionTable = sqliteTable('session' as string, {
  id: text('id').primaryKey(),
  shop: text('shop').notNull(),
  state: text('state').notNull(),
  isOnline: integer('isOnline', { mode: 'boolean' }).notNull().default(false),
  scope: text('scope'),
  expires: text('expires'),
  accessToken: text('accessToken').notNull(),
  userId: blob('userId', { mode: 'bigint' }),
  firstName: text('firstName'),
  lastName: text('lastName'),
  email: text('email'),
  accountOwner: integer('accountOwner', { mode: 'boolean' }),
  locale: text('locale'),
  collaborator: integer('collaborator', { mode: 'boolean' }),
  emailVerified: integer('emailVerified', { mode: 'boolean' }),
  refreshToken: text('refreshToken'),
  refreshTokenExpires: text('refreshTokenExpires'),
});

export type SQLiteSessionTable = typeof sessionTable;
