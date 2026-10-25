CREATE TABLE `delivery_events` (
	`id` text PRIMARY KEY NOT NULL,
	`smtp_config_id` text NOT NULL,
	`provider` text NOT NULL,
	`event_key` text NOT NULL,
	`kind` text NOT NULL,
	`email_id` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `deliveryEvents_smtpConfigId_eventKey_unique` ON `delivery_events` (`smtp_config_id`,`event_key`);--> statement-breakpoint
CREATE INDEX `deliveryEvents_createdAt_idx` ON `delivery_events` (`created_at`);--> statement-breakpoint
ALTER TABLE `smtp_config` ADD `bounce_webhook_provider` text;--> statement-breakpoint
ALTER TABLE `smtp_config` ADD `bounce_webhook_secret` text;