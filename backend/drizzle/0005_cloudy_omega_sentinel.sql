ALTER TABLE `smtp_config` ADD `last_check_at` integer;--> statement-breakpoint
ALTER TABLE `smtp_config` ADD `last_check_ok` integer;--> statement-breakpoint
ALTER TABLE `smtp_config` ADD `last_check_error` text;