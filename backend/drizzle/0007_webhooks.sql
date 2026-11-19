CREATE TABLE `webhook_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`endpoint_id` text NOT NULL,
	`email_id` text,
	`event_type` text NOT NULL,
	`failure_kind` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_status_code` integer,
	`last_error` text,
	`last_attempt_at` integer,
	`delivered_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`endpoint_id`) REFERENCES `webhook_endpoints`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `webhookDeliveries_emailId_endpointId_unique` ON `webhook_deliveries` (`email_id`,`endpoint_id`);--> statement-breakpoint
CREATE INDEX `webhookDeliveries_endpointId_createdAt_idx` ON `webhook_deliveries` (`endpoint_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `webhookDeliveries_status_createdAt_idx` ON `webhook_deliveries` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `webhook_endpoints` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`url` text NOT NULL,
	`secret` text NOT NULL,
	`previous_secret` text,
	`previous_secret_expires_at` integer,
	`enabled` integer DEFAULT true NOT NULL,
	`disabled_reason` text,
	`consecutive_failures` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `webhookEndpoints_userId_idx` ON `webhook_endpoints` (`user_id`);