CREATE TABLE `email_histories` (
	`id` text PRIMARY KEY NOT NULL,
	`email_id` text NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `email_logs` (
	`internalId` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`to` text NOT NULL,
	`subject` text NOT NULL,
	`smtp_id` text NOT NULL,
	`sent_at` text NOT NULL,
	`email_processing_time` integer
);
