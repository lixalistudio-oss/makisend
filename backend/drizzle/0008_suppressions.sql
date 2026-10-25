CREATE TABLE `suppressions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`recipient` text NOT NULL,
	`recipient_hash` text NOT NULL,
	`hash_kid` text NOT NULL,
	`source` text NOT NULL,
	`reason` text NOT NULL,
	`email_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `suppressions_userId_recipientHash_unique` ON `suppressions` (`user_id`,`recipient_hash`);--> statement-breakpoint
CREATE INDEX `suppressions_hashKid_idx` ON `suppressions` (`hash_kid`);