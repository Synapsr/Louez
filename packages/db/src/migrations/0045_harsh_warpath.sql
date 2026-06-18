CREATE TABLE `referral_rewards` (
	`id` varchar(21) NOT NULL,
	`referrer_store_id` varchar(21) NOT NULL,
	`referred_store_id` varchar(21) NOT NULL,
	`referred_user_id` varchar(21),
	`qualifying_reservation_id` varchar(21),
	`qualifying_payment_id` varchar(21),
	`qualifying_amount_cents` int NOT NULL,
	`currency` varchar(3) NOT NULL DEFAULT 'eur',
	`stripe_payment_intent_id` varchar(255),
	`stripe_charge_id` varchar(255),
	`stripe_invoice_item_id` varchar(255),
	`referral_reward_kind` enum('free_reservations','invoice_credit') NOT NULL,
	`free_reservations` int NOT NULL DEFAULT 0,
	`credit_cents` int NOT NULL DEFAULT 0,
	`granted_month` varchar(7) NOT NULL,
	`referral_reward_status` enum('granted','clawed_back') NOT NULL DEFAULT 'granted',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`clawed_back_at` timestamp,
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `referral_rewards_id` PRIMARY KEY(`id`),
	CONSTRAINT `referral_rewards_referred_store_id_unique` UNIQUE(`referred_store_id`)
);
--> statement-breakpoint
CREATE INDEX `referral_rewards_referrer_month_idx` ON `referral_rewards` (`referrer_store_id`,`granted_month`);--> statement-breakpoint
CREATE INDEX `referral_rewards_charge_idx` ON `referral_rewards` (`stripe_charge_id`);--> statement-breakpoint
CREATE INDEX `referral_rewards_payment_intent_idx` ON `referral_rewards` (`stripe_payment_intent_id`);