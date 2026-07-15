CREATE TABLE `email_log` (
	`internalId` text PRIMARY KEY,
	`to` text NOT NULL,
	`subject` text NOT NULL,
	`smtp_id` text NOT NULL,
	`sent_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `logs` (
	`internalId` text PRIMARY KEY,
	`endpoint` text NOT NULL,
	`message` text NOT NULL,
	`details` text,
	`sent_at` text NOT NULL
);
