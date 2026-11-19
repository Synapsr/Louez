CREATE TABLE `partner_bookings` (
	`id` varchar(21) NOT NULL,
	`store_id` varchar(21) NOT NULL,
	`partner_id` varchar(21) NOT NULL,
	`reservation_id` varchar(21) NOT NULL,
	`commission_type` enum('percent','fixed') NOT NULL,
	`commission_value` decimal(10,2) NOT NULL,
	`origin` enum('link','manual') NOT NULL,
	`adjusted_amount` decimal(10,2),
	`adjustment_note` varchar(200),
	`attributed_by` varchar(21),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `partner_bookings_id` PRIMARY KEY(`id`),
	CONSTRAINT `partner_bookings_reservation_unique` UNIQUE(`reservation_id`)
);
--> statement-breakpoint
CREATE TABLE `partner_payouts` (
	`id` varchar(21) NOT NULL,
	`store_id` varchar(21) NOT NULL,
	`partner_id` varchar(21) NOT NULL,
	`month` varchar(7) NOT NULL,
	`amount` decimal(10,2) NOT NULL,
	`currency` varchar(3) NOT NULL,
	`user_id` varchar(21),
	`paid_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `partner_payouts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `store_partners` (
	`id` varchar(21) NOT NULL,
	`store_id` varchar(21) NOT NULL,
	`name` varchar(120) NOT NULL,
	`contact_name` varchar(120),
	`contact_email` varchar(255),
	`contact_phone` varchar(40),
	`code` varchar(40) NOT NULL,
	`commission_type` enum('percent','fixed') NOT NULL,
	`commission_value` decimal(10,2) NOT NULL,
	`statement_token` varchar(43) NOT NULL,
	`archived_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `store_partners_id` PRIMARY KEY(`id`),
	CONSTRAINT `store_partners_store_code_unique` UNIQUE(`store_id`,`code`),
	CONSTRAINT `store_partners_statement_token_unique` UNIQUE(`statement_token`)
);
--> statement-breakpoint
ALTER TABLE `page_views` ADD `partner_id` varchar(21);--> statement-breakpoint
CREATE INDEX `partner_bookings_store_partner_idx` ON `partner_bookings` (`store_id`,`partner_id`);--> statement-breakpoint
CREATE INDEX `partner_payouts_store_partner_month_idx` ON `partner_payouts` (`store_id`,`partner_id`,`month`);