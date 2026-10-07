CREATE INDEX `emailHistories_emailId_createdAt_idx` ON `email_histories` (`email_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `emailLogs_userId_createdAt_idx` ON `email_logs` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `emailLogs_apiKeyId_idx` ON `email_logs` (`apikey_id`);