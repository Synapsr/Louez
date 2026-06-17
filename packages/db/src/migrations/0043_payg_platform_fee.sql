CREATE TABLE `platform_fee` (
	`id` varchar(21) NOT NULL,
	`store_id` varchar(21) NOT NULL,
	`reservation_id` varchar(21) NOT NULL,
	`payment_id` varchar(21),
	`dedup_key` varchar(80) NOT NULL,
	`amount_cents` int NOT NULL,
	`amount_reversed_cents` int NOT NULL DEFAULT 0,
	`currency` varchar(3) NOT NULL DEFAULT 'eur',
	`platform_fee_source` enum('online','manual','free') NOT NULL,
	`platform_fee_status` enum('pending','collected','billed','voided','reversed') NOT NULL,
	`billing_month` varchar(7) NOT NULL,
	`monthly_index` int,
	`stripe_payment_intent_id` varchar(255),
	`stripe_application_fee_id` varchar(255),
	`invoice_id` varchar(21),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`billed_at` timestamp,
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `platform_fee_id` PRIMARY KEY(`id`),
	CONSTRAINT `platform_fee_dedup_key_unique` UNIQUE(`dedup_key`)
);
--> statement-breakpoint
DROP TABLE `pay_as_you_go_usage`;--> statement-breakpoint
-- The free "start" plan no longer exists. Migrate any existing 'start' rows to
-- pay-as-you-go before changing the column default (a real paying customer should never
-- carry the 'start' slug, so rows with a Stripe subscription are left untouched).
UPDATE `subscriptions` SET `plan_slug` = 'pay_as_you_go' WHERE `plan_slug` = 'start' AND `billing_mode` = 'pay_as_you_go';--> statement-breakpoint
UPDATE `subscriptions` SET `plan_slug` = 'pay_as_you_go', `billing_mode` = 'pay_as_you_go' WHERE `plan_slug` = 'start' AND `billing_mode` = 'subscription' AND `stripe_subscription_id` IS NULL;--> statement-breakpoint
ALTER TABLE `subscriptions` MODIFY COLUMN `plan_slug` varchar(50) NOT NULL DEFAULT 'pay_as_you_go';--> statement-breakpoint
ALTER TABLE `subscriptions` MODIFY COLUMN `billing_mode` enum('subscription','pay_as_you_go') NOT NULL DEFAULT 'pay_as_you_go';--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `free_reservations_granted` int DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `platform_fee_store_month_idx` ON `platform_fee` (`store_id`,`billing_month`,`platform_fee_status`);--> statement-breakpoint
CREATE INDEX `platform_fee_status_idx` ON `platform_fee` (`platform_fee_status`);--> statement-breakpoint
CREATE INDEX `platform_fee_reservation_idx` ON `platform_fee` (`reservation_id`);--> statement-breakpoint
CREATE INDEX `platform_fee_payment_intent_idx` ON `platform_fee` (`stripe_payment_intent_id`,`platform_fee_status`);