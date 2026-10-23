CREATE TABLE `email_contents` (
	`email_id` text PRIMARY KEY NOT NULL,
	`text_body` text NOT NULL,
	`html_body` text NOT NULL,
	`smtp_config_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`email_id`) REFERENCES `email_logs`(`internalId`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `idempotency_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`route` text NOT NULL,
	`key` text NOT NULL,
	`request_hash` text NOT NULL,
	`status_code` integer,
	`response_body` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idempotencyKeys_userId_route_key_unique` ON `idempotency_keys` (`user_id`,`route`,`key`);--> statement-breakpoint
CREATE INDEX `idempotencyKeys_expiresAt_idx` ON `idempotency_keys` (`expires_at`);