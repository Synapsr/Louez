ALTER TABLE `payments` ADD `release_owed_at` timestamp;--> statement-breakpoint
ALTER TABLE `payments` ADD `provider_requested_at` timestamp;--> statement-breakpoint
ALTER TABLE `payments` ADD `claimed_until` timestamp;