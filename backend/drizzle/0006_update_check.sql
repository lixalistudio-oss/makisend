CREATE TABLE `update_check` (
	`id` text PRIMARY KEY NOT NULL,
	`latest_version` text,
	`release_name` text,
	`release_url` text,
	`release_notes` text,
	`published_at` text,
	`checked_at` integer NOT NULL,
	`error` text
);
