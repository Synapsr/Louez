CREATE TABLE `product_units` (
	`id` varchar(21) NOT NULL,
	`product_id` varchar(21) NOT NULL,
	`identifier` varchar(255) NOT NULL,
	`notes` text,
	`unit_status` enum('available','maintenance','retired') NOT NULL DEFAULT 'available',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `product_units_id` PRIMARY KEY(`id`),
	CONSTRAINT `product_units_unique_identifier` UNIQUE(`product_id`,`identifier`)
);
--> statement-breakpoint
CREATE TABLE `reservation_item_units` (
	`id` varchar(21) NOT NULL,
	`reservation_item_id` varchar(21) NOT NULL,
	`product_unit_id` varchar(21) NOT NULL,
	`identifier_snapshot` varchar(255) NOT NULL,
	`assigned_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `reservation_item_units_id` PRIMARY KEY(`id`),
	CONSTRAINT `reservation_item_units_unique` UNIQUE(`reservation_item_id`,`product_unit_id`)
);
--> statement-breakpoint
ALTER TABLE `products` ADD `track_units` boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `product_units_product_idx` ON `product_units` (`product_id`);--> statement-breakpoint
CREATE INDEX `product_units_status_idx` ON `product_units` (`product_id`,`unit_status`);--> statement-breakpoint
CREATE INDEX `reservation_item_units_item_idx` ON `reservation_item_units` (`reservation_item_id`);--> statement-breakpoint
CREATE INDEX `reservation_item_units_unit_idx` ON `reservation_item_units` (`product_unit_id`);