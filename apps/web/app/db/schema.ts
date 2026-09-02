// Verbatim copy of @shopify/shopify-app-session-storage-drizzle's canonical
// postgres schema (v5.0.1 — src/schemas/postgres.schema.ts). Re-diff on adapter
// bumps. The adapter does not export this or its table type
// (`PostgresSessionTable`) — see ADR 0005.
//
// 17 columns, canonical camelCase SQL identifiers, SQL table name `session`.
// No columns added or removed: the associated-user columns (`userId`,
// `firstName`, `lastName`, `email`, `accountOwner`, `locale`, `collaborator`,
// `emailVerified`) and the expiring-offline-token columns (`refreshToken`,
// `refreshTokenExpires`) stay even though offline-only auth (ADR 0002) leaves
// them null.

import { bigint, boolean, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const sessionTable = pgTable('session' as string, {
  id: text('id').primaryKey(),
  shop: text('shop').notNull(),
  state: text('state').notNull(),
  isOnline: boolean('isOnline').default(false).notNull(),
  scope: text('scope'),
  expires: timestamp('expires', { mode: 'date' }),
  accessToken: text('accessToken').notNull(),
  userId: bigint('userId', { mode: 'number' }),
  firstName: text('firstName'),
  lastName: text('lastName'),
  email: text('email'),
  accountOwner: boolean('accountOwner'),
  locale: text('locale'),
  collaborator: boolean('collaborator'),
  emailVerified: boolean('emailVerified'),
  refreshToken: text('refreshToken'),
  refreshTokenExpires: timestamp('refreshTokenExpires', { mode: 'date' }),
});

export type PostgresSessionTable = typeof sessionTable;
