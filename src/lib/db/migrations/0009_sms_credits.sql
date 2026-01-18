CREATE TABLE `sms_credits` (
	`id` varchar(21) NOT NULL,
	`store_id` varchar(21) NOT NULL,
	`balance` int NOT NULL DEFAULT 0,
	`total_purchased` int NOT NULL DEFAULT 0,
	`total_used` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `sms_credits_id` PRIMARY KEY(`id`),
	CONSTRAINT `sms_credits_store_id_unique` UNIQUE(`store_id`)
);
--> statement-breakpoint
CREATE TABLE `sms_topup_transactions` (
	`id` varchar(21) NOT NULL,
	`store_id` varchar(21) NOT NULL,
	`quantity` int NOT NULL,
	`unit_price_cents` int NOT NULL,
	`total_amount_cents` int NOT NULL,
	`currency` varchar(3) NOT NULL DEFAULT 'eur',
	`stripe_session_id` varchar(255),
	`stripe_payment_intent_id` varchar(255),
	`sms_topup_status` enum('pending','completed','failed','refunded') NOT NULL DEFAULT 'pending',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`completed_at` timestamp,
	CONSTRAINT `sms_topup_transactions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `sms_logs` ADD `credit_source` varchar(20) DEFAULT 'plan';--> statement-breakpoint
CREATE INDEX `sms_credits_store_idx` ON `sms_credits` (`store_id`);--> statement-breakpoint
CREATE INDEX `sms_topup_store_idx` ON `sms_topup_transactions` (`store_id`);--> statement-breakpoint
CREATE INDEX `sms_topup_status_idx` ON `sms_topup_transactions` (`sms_topup_status`);--> statement-breakpoint
CREATE INDEX `sms_topup_stripe_session_idx` ON `sms_topup_transactions` (`stripe_session_id`);