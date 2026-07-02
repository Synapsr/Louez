CREATE TABLE `product_unit_downtimes` (
	`id` varchar(21) NOT NULL,
	`product_unit_id` varchar(21) NOT NULL,
	`store_id` varchar(21) NOT NULL,
	`reason` enum('maintenance','repair','other') NOT NULL,
	`starts_at` timestamp NOT NULL,
	`ends_at` timestamp,
	`note` text,
	`created_by_user_id` varchar(21),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `product_unit_downtimes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `product_unit_events` (
	`id` varchar(21) NOT NULL,
	`product_unit_id` varchar(21) NOT NULL,
	`store_id` varchar(21) NOT NULL,
	`type` enum('created','downtime_declared','downtime_updated','downtime_closed','downtime_deleted','retired','reinstated','assigned','unassigned','updated') NOT NULL,
	`actor_user_id` varchar(21),
	`payload` json,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `product_unit_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
DROP INDEX `product_units_status_idx` ON `product_units`;--> statement-breakpoint
DROP INDEX `product_units_status_combination_idx` ON `product_units`;--> statement-breakpoint
ALTER TABLE `product_units` ADD `lifecycle_status` enum('active','retired') DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE `product_units` ADD `retired_at` timestamp;--> statement-breakpoint
ALTER TABLE `product_units` ADD `retirement_reason` enum('sold','lost','broken','other');--> statement-breakpoint
ALTER TABLE `product_units` ADD `retirement_note` text;--> statement-breakpoint
ALTER TABLE `product_units` ADD `purchase_price` decimal(10,2);--> statement-breakpoint
ALTER TABLE `product_units` ADD `purchased_at` timestamp;--> statement-breakpoint
UPDATE `product_units`
SET `lifecycle_status` = 'active'
WHERE `unit_status` IN ('available', 'maintenance');--> statement-breakpoint
INSERT INTO `product_unit_downtimes` (
	`id`,
	`product_unit_id`,
	`store_id`,
	`reason`,
	`starts_at`,
	`ends_at`,
	`note`,
	`created_by_user_id`,
	`created_at`,
	`updated_at`
)
SELECT
	LEFT(REPLACE(UUID(), '-', ''), 21),
	`product_units`.`id`,
	`products`.`store_id`,
	'maintenance',
	NOW(),
	NULL,
	'Migrated from legacy maintenance status',
	NULL,
	NOW(),
	NOW()
FROM `product_units`
INNER JOIN `products`
	ON `products`.`id` = `product_units`.`product_id`
WHERE `product_units`.`unit_status` = 'maintenance';--> statement-breakpoint
INSERT INTO `product_unit_events` (
	`id`,
	`product_unit_id`,
	`store_id`,
	`type`,
	`actor_user_id`,
	`payload`,
	`created_at`
)
SELECT
	LEFT(REPLACE(UUID(), '-', ''), 21),
	`product_units`.`id`,
	`products`.`store_id`,
	'downtime_declared',
	NULL,
	JSON_OBJECT('reason', 'maintenance'),
	NOW()
FROM `product_units`
INNER JOIN `products`
	ON `products`.`id` = `product_units`.`product_id`
WHERE `product_units`.`unit_status` = 'maintenance';--> statement-breakpoint
UPDATE `product_units`
SET
	`lifecycle_status` = 'retired',
	`retired_at` = NOW(),
	`retirement_reason` = 'other',
	`retirement_note` = 'Migrated from legacy retired status'
WHERE `unit_status` = 'retired';--> statement-breakpoint
INSERT INTO `product_unit_events` (
	`id`,
	`product_unit_id`,
	`store_id`,
	`type`,
	`actor_user_id`,
	`payload`,
	`created_at`
)
SELECT
	LEFT(REPLACE(UUID(), '-', ''), 21),
	`product_units`.`id`,
	`products`.`store_id`,
	'retired',
	NULL,
	JSON_OBJECT('reason', 'other'),
	NOW()
FROM `product_units`
INNER JOIN `products`
	ON `products`.`id` = `product_units`.`product_id`
WHERE `product_units`.`unit_status` = 'retired';--> statement-breakpoint
ALTER TABLE `product_unit_downtimes` ADD CONSTRAINT `product_unit_downtimes_product_unit_id_product_units_id_fk` FOREIGN KEY (`product_unit_id`) REFERENCES `product_units`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `product_unit_events` ADD CONSTRAINT `product_unit_events_product_unit_id_product_units_id_fk` FOREIGN KEY (`product_unit_id`) REFERENCES `product_units`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `product_unit_downtimes_unit_starts_at_idx` ON `product_unit_downtimes` (`product_unit_id`,`starts_at`);--> statement-breakpoint
CREATE INDEX `product_unit_downtimes_store_idx` ON `product_unit_downtimes` (`store_id`);--> statement-breakpoint
CREATE INDEX `product_unit_downtimes_active_at_idx` ON `product_unit_downtimes` (`store_id`,`starts_at`,`ends_at`);--> statement-breakpoint
CREATE INDEX `product_unit_events_unit_created_at_idx` ON `product_unit_events` (`product_unit_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `product_units_lifecycle_status_idx` ON `product_units` (`product_id`,`lifecycle_status`);--> statement-breakpoint
CREATE INDEX `product_units_lifecycle_status_combination_idx` ON `product_units` (`product_id`,`lifecycle_status`,`combination_key`);--> statement-breakpoint
ALTER TABLE `product_units` DROP COLUMN `unit_status`;
