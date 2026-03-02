CREATE TABLE `promo_codes` (
	`id` varchar(21) NOT NULL,
	`store_id` varchar(21) NOT NULL,
	`code` varchar(50) NOT NULL,
	`description` text,
	`promo_code_type` enum('percentage','fixed') NOT NULL,
	`value` decimal(10,2) NOT NULL,
	`minimum_amount` decimal(10,2),
	`max_usage_count` int,
	`current_usage_count` int NOT NULL DEFAULT 0,
	`starts_at` timestamp,
	`expires_at` timestamp,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `promo_codes_id` PRIMARY KEY(`id`),
	CONSTRAINT `promo_codes_unique_code` UNIQUE(`store_id`,`code`)
);
--> statement-breakpoint
ALTER TABLE `reservations` ADD `promo_code_id` varchar(21);--> statement-breakpoint
ALTER TABLE `reservations` ADD `discount_amount` decimal(10,2) DEFAULT '0';--> statement-breakpoint
ALTER TABLE `reservations` ADD `promo_code_snapshot` json;--> statement-breakpoint
CREATE INDEX `promo_codes_store_idx` ON `promo_codes` (`store_id`);--> statement-breakpoint
CREATE INDEX `promo_codes_active_idx` ON `promo_codes` (`store_id`,`is_active`);