CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`shop` text NOT NULL,
	`state` text NOT NULL,
	`isOnline` integer DEFAULT false NOT NULL,
	`scope` text,
	`expires` text,
	`accessToken` text NOT NULL,
	`userId` blob,
	`firstName` text,
	`lastName` text,
	`email` text,
	`accountOwner` integer,
	`locale` text,
	`collaborator` integer,
	`emailVerified` integer,
	`refreshToken` text,
	`refreshTokenExpires` text
);
