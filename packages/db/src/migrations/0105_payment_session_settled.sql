ALTER TABLE `payments` ADD `session_settled_at` timestamp;--> statement-breakpoint
CREATE INDEX `payments_session_settled_created_idx` ON `payments` (`session_settled_at`,`created_at`);