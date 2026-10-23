DROP INDEX `apikey_smtp_config_id_unique`;--> statement-breakpoint
CREATE INDEX `apikey_smtpConfigId_idx` ON `apikey` (`smtp_config_id`);--> statement-breakpoint
ALTER TABLE `email_logs` ADD `source` text DEFAULT 'api' NOT NULL;--> statement-breakpoint
ALTER TABLE `email_logs` ADD `smtp_config_id` text;