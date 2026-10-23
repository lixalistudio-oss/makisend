CREATE TABLE `email_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`email_id` text NOT NULL,
	`position` integer NOT NULL,
	`filename` text NOT NULL,
	`content_type` text NOT NULL,
	`content` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`email_id`) REFERENCES `email_logs`(`internalId`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `emailAttachments_emailId_position_unique` ON `email_attachments` (`email_id`,`position`);