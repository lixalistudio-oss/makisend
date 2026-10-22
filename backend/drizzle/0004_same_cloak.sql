ALTER TABLE `smtp_config` ADD `smtp_port` integer DEFAULT 465 NOT NULL;--> statement-breakpoint
ALTER TABLE `smtp_config` ADD `smtp_security` text DEFAULT 'tls' NOT NULL;