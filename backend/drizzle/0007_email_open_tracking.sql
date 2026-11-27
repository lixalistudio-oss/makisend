ALTER TABLE `email_logs` ADD `tracking_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `email_logs` ADD `tracking_token` text;--> statement-breakpoint
ALTER TABLE `email_logs` ADD `tracking_base_url` text;--> statement-breakpoint
ALTER TABLE `email_logs` ADD `first_opened_at` text;--> statement-breakpoint
ALTER TABLE `email_logs` ADD `last_opened_at` text;--> statement-breakpoint
ALTER TABLE `email_logs` ADD `open_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `emailLogs_trackingToken_idx` ON `email_logs` (`tracking_token`);--> statement-breakpoint
ALTER TABLE `user` ADD `open_tracking_enabled` integer DEFAULT false NOT NULL;