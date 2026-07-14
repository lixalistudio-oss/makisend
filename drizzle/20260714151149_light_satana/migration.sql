CREATE TABLE `logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`endpoint` text NOT NULL,
	`message` text NOT NULL,
	`details` text,
	`sent_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `email_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`to` text NOT NULL,
	`subject` text NOT NULL,
	`message_id` text NOT NULL,
	`sent_at` text NOT NULL
);
