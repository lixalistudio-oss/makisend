CREATE TABLE `send_rate_limit` (
	`api_key_id` text PRIMARY KEY NOT NULL,
	`window_start` integer NOT NULL,
	`count` integer NOT NULL,
	FOREIGN KEY (`api_key_id`) REFERENCES `apikey`(`id`) ON UPDATE no action ON DELETE cascade
);
