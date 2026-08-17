CREATE TABLE `marketplace_booking_attempts` (
	`id` varchar(21) NOT NULL,
	`booking_attempt_id` varchar(36) NOT NULL,
	`store_id` varchar(21) NOT NULL,
	`quote_token_hash` varchar(64) NOT NULL,
	`hold_id` varchar(21),
	`reservation_id` varchar(21),
	`status` varchar(32) NOT NULL DEFAULT 'creating_hold',
	`expires_at` timestamp NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `marketplace_booking_attempts_id` PRIMARY KEY(`id`),
	CONSTRAINT `marketplace_booking_attempts_booking_attempt_id_unique` UNIQUE(`booking_attempt_id`),
	CONSTRAINT `marketplace_booking_attempts_reservation_idx` UNIQUE(`reservation_id`),
	CONSTRAINT `marketplace_booking_attempts_hold_idx` UNIQUE(`hold_id`)
);
--> statement-breakpoint
ALTER TABLE `customers` ADD `marketplace_user_id` varchar(255);--> statement-breakpoint
CREATE INDEX `marketplace_booking_attempts_store_idx` ON `marketplace_booking_attempts` (`store_id`);--> statement-breakpoint
CREATE INDEX `marketplace_booking_attempts_expires_at_idx` ON `marketplace_booking_attempts` (`expires_at`);--> statement-breakpoint
CREATE INDEX `marketplace_booking_attempts_updated_at_id_idx` ON `marketplace_booking_attempts` (`updated_at`,`id`);--> statement-breakpoint
CREATE INDEX `customers_marketplace_user_idx` ON `customers` (`marketplace_user_id`);