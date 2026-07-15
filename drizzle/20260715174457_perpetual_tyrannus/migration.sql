CREATE TABLE `email_logs` (
	`internalId` text PRIMARY KEY,
	`to` text NOT NULL,
	`subject` text NOT NULL,
	`smtp_id` text NOT NULL,
	`sent_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `logs` (
	`id` text PRIMARY KEY,
	`endpoint` text NOT NULL,
	`message` text NOT NULL,
	`message_details` text NOT NULL,
	`sent_at` text NOT NULL
);
