ALTER TABLE `product_unit_events` DROP FOREIGN KEY `product_unit_events_product_unit_id_product_units_id_fk`;
--> statement-breakpoint
ALTER TABLE `product_unit_events` MODIFY COLUMN `product_unit_id` varchar(21);--> statement-breakpoint
ALTER TABLE `product_unit_events` MODIFY COLUMN `type` enum('created','deleted','downtime_declared','downtime_updated','downtime_closed','downtime_deleted','retired','reinstated','assigned','unassigned','updated') NOT NULL;--> statement-breakpoint
ALTER TABLE `product_unit_events` ADD `identifier_snapshot` varchar(255);--> statement-breakpoint
UPDATE `product_unit_events` pue
INNER JOIN `product_units` pu ON pu.`id` = pue.`product_unit_id`
SET pue.`identifier_snapshot` = pu.`identifier`
WHERE pue.`identifier_snapshot` IS NULL;--> statement-breakpoint
ALTER TABLE `product_unit_events` ADD CONSTRAINT `product_unit_events_product_unit_id_product_units_id_fk` FOREIGN KEY (`product_unit_id`) REFERENCES `product_units`(`id`) ON DELETE set null ON UPDATE no action;
