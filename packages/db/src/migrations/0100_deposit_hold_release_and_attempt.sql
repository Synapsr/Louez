ALTER TABLE `payments` ADD `release_owed_at` timestamp;--> statement-breakpoint
ALTER TABLE `payments` ADD `provider_requested_at` timestamp;--> statement-breakpoint
ALTER TABLE `payments` ADD `claimed_until` timestamp;--> statement-breakpoint
ALTER TABLE `payments` ADD `claim_token` varchar(21);--> statement-breakpoint
ALTER TABLE `payments` ADD `stripe_customer_id` varchar(255);--> statement-breakpoint
CREATE INDEX `payments_payment_intent_idx` ON `payments` (`stripe_payment_intent_id`);