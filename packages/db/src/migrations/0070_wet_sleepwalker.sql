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
CREATE TABLE `marketplace_catalog_tombstones` (
	`id` varchar(21) NOT NULL,
	`entity_type` enum('store','product') NOT NULL,
	`entity_id` varchar(21) NOT NULL,
	`deleted_at` timestamp NOT NULL DEFAULT (now()),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `marketplace_catalog_tombstones_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `store_marketplace_category_mappings` (
	`id` varchar(21) NOT NULL,
	`store_id` varchar(21) NOT NULL,
	`category_id` varchar(21) NOT NULL,
	`marketplace_category_slug` varchar(160) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `store_marketplace_category_mappings_id` PRIMARY KEY(`id`),
	CONSTRAINT `store_marketplace_category_mappings_store_category_unique` UNIQUE(`store_id`,`category_id`)
);
--> statement-breakpoint
CREATE TABLE `store_marketplace_channels` (
	`id` varchar(21) NOT NULL,
	`store_id` varchar(21) NOT NULL,
	`enabled_by_owner` boolean NOT NULL DEFAULT false,
	`owner_decided_at` timestamp,
	`status` enum('setup_required','pending','published','paused','disabled') NOT NULL DEFAULT 'setup_required',
	`published_at` timestamp,
	`lifetime_fee_waiver_at` timestamp,
	`cohort_rank` int,
	`disabled_at` timestamp,
	`terms_accepted_at` timestamp,
	`consent_basis` enum('explicit','terms_update') NOT NULL DEFAULT 'explicit',
	`claimed_business_id` varchar(255),
	`claim_confirmed_at` timestamp,
	`status_reason` varchar(255),
	`version` int NOT NULL DEFAULT 1,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `store_marketplace_channels_id` PRIMARY KEY(`id`),
	CONSTRAINT `store_marketplace_channels_store_id_unique` UNIQUE(`store_id`),
	CONSTRAINT `store_marketplace_channels_cohort_rank_unique` UNIQUE(`cohort_rank`)
);
--> statement-breakpoint
ALTER TABLE `platform_fee` MODIFY COLUMN `platform_fee_source` enum('online','manual','free','marketplace_online','marketplace_manual','marketplace_waived') NOT NULL;--> statement-breakpoint
ALTER TABLE `customers` ADD `marketplace_user_id` varchar(255);--> statement-breakpoint
ALTER TABLE `pay_as_you_go_invoices` ADD `usage_location_count` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `pay_as_you_go_invoices` ADD `usage_fee_amount_cents` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `pay_as_you_go_invoices` ADD `marketplace_reservation_count` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `pay_as_you_go_invoices` ADD `marketplace_fee_amount_cents` int DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `pay_as_you_go_invoices`
SET
	`usage_location_count` = `location_count`,
	`usage_fee_amount_cents` = `invoiced_amount_cents`;--> statement-breakpoint
ALTER TABLE `stores` ADD `signup_origin` varchar(32);--> statement-breakpoint
ALTER TABLE `users` ADD `signup_origin` varchar(32);--> statement-breakpoint
ALTER TABLE `users` ADD `reeent_intro_acknowledged_at` timestamp;--> statement-breakpoint
CREATE INDEX `marketplace_booking_attempts_store_idx` ON `marketplace_booking_attempts` (`store_id`);--> statement-breakpoint
CREATE INDEX `marketplace_booking_attempts_expires_at_idx` ON `marketplace_booking_attempts` (`expires_at`);--> statement-breakpoint
CREATE INDEX `marketplace_booking_attempts_updated_at_id_idx` ON `marketplace_booking_attempts` (`updated_at`,`id`);--> statement-breakpoint
CREATE INDEX `marketplace_catalog_tombstones_deleted_at_id_idx` ON `marketplace_catalog_tombstones` (`deleted_at`,`id`);--> statement-breakpoint
CREATE INDEX `marketplace_catalog_tombstones_entity_idx` ON `marketplace_catalog_tombstones` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `store_marketplace_category_mappings_store_idx` ON `store_marketplace_category_mappings` (`store_id`);--> statement-breakpoint
CREATE INDEX `store_marketplace_category_mappings_category_idx` ON `store_marketplace_category_mappings` (`category_id`);--> statement-breakpoint
CREATE INDEX `store_marketplace_channels_status_updated_idx` ON `store_marketplace_channels` (`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `customers_marketplace_user_idx` ON `customers` (`marketplace_user_id`);
