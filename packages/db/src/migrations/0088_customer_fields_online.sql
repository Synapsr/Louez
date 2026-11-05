CREATE TABLE `customer_field_targets` (
	`id` varchar(21) NOT NULL,
	`store_id` varchar(21) NOT NULL,
	`definition_id` varchar(21) NOT NULL,
	`target_type` enum('category','product') NOT NULL,
	`target_id` varchar(21) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `customer_field_targets_id` PRIMARY KEY(`id`),
	CONSTRAINT `customer_field_targets_definition_target_unique` UNIQUE(`definition_id`,`target_type`,`target_id`)
);
--> statement-breakpoint
CREATE TABLE `reservation_item_details` (
	`id` varchar(21) NOT NULL,
	`store_id` varchar(21) NOT NULL,
	`reservation_id` varchar(21) NOT NULL,
	`reservation_item_id` varchar(21) NOT NULL,
	`unit_index` int NOT NULL,
	`participant_name` varchar(100),
	`values` json NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `reservation_item_details_id` PRIMARY KEY(`id`),
	CONSTRAINT `reservation_item_details_item_unit_unique` UNIQUE(`reservation_item_id`,`unit_index`)
);
--> statement-breakpoint
ALTER TABLE `customer_field_definitions` ADD `scope` enum('customer','item') DEFAULT 'customer' NOT NULL;--> statement-breakpoint
ALTER TABLE `customer_field_definitions` ADD `collect_mode` enum('never','optional','required') DEFAULT 'never' NOT NULL;--> statement-breakpoint
ALTER TABLE `customer_field_definitions` ADD `target_mode` enum('all','products') DEFAULT 'all' NOT NULL;--> statement-breakpoint
ALTER TABLE `customer_field_definitions` ADD `customer_editable` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `reservation_item_details` ADD CONSTRAINT `rid_reservation_item_fk` FOREIGN KEY (`reservation_item_id`) REFERENCES `reservation_items`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `customer_field_targets_store_idx` ON `customer_field_targets` (`store_id`);--> statement-breakpoint
CREATE INDEX `customer_field_targets_target_idx` ON `customer_field_targets` (`target_id`);--> statement-breakpoint
CREATE INDEX `reservation_item_details_reservation_idx` ON `reservation_item_details` (`reservation_id`);--> statement-breakpoint
CREATE INDEX `reservation_item_details_store_idx` ON `reservation_item_details` (`store_id`);