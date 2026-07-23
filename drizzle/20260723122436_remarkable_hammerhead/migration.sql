CREATE TABLE `email_logs` (
	`internalId` text PRIMARY KEY,
	`to` text NOT NULL,
	`subject` text NOT NULL,
	`smtp_id` text NOT NULL,
	`sent_at` text NOT NULL,
	`email_processing_time` integer
);
