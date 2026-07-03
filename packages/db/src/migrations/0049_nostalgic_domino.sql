ALTER TABLE `product_unit_events` DROP FOREIGN KEY `product_unit_events_product_unit_id_product_units_id_fk`;
--> statement-breakpoint
ALTER TABLE `product_unit_events` MODIFY COLUMN `product_unit_id` varchar(21);--> statement-breakpoint
ALTER TABLE `product_unit_events` MODIFY COLUMN `type` enum('created','deleted','downtime_declared','downtime_updated','downtime_closed','downtime_deleted','retired','reinstated','assigned','unassigned','updated') NOT NULL;--> statement-breakpoint
ALTER TABLE `reservation_item_units` MODIFY COLUMN `product_unit_id` varchar(21);--> statement-breakpoint
ALTER TABLE `product_unit_events` ADD `identifier_snapshot` varchar(255);--> statement-breakpoint
UPDATE `product_unit_events` pue
INNER JOIN `product_units` pu ON pu.`id` = pue.`product_unit_id`
SET pue.`identifier_snapshot` = pu.`identifier`
WHERE pue.`identifier_snapshot` IS NULL;--> statement-breakpoint
ALTER TABLE `product_unit_events` ADD CONSTRAINT `product_unit_events_product_unit_id_product_units_id_fk` FOREIGN KEY (`product_unit_id`) REFERENCES `product_units`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Existing deployments may contain orphaned assignment rows because this table
-- previously had no foreign keys. Run this migration with app traffic quiesced
-- so new assignment rows cannot be inserted between the purge and FK creation.
DELETE riu FROM `reservation_item_units` riu
LEFT JOIN `reservation_items` ri ON ri.`id` = riu.`reservation_item_id`
LEFT JOIN `product_units` pu ON pu.`id` = riu.`product_unit_id`
WHERE ri.`id` IS NULL
  OR (riu.`product_unit_id` IS NOT NULL AND pu.`id` IS NULL);--> statement-breakpoint
ALTER TABLE `reservation_item_units` ADD CONSTRAINT `riu_reservation_item_fk` FOREIGN KEY (`reservation_item_id`) REFERENCES `reservation_items`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `reservation_item_units` ADD CONSTRAINT `riu_product_unit_fk` FOREIGN KEY (`product_unit_id`) REFERENCES `product_units`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
UPDATE `products` p
SET `quantity` = (
  SELECT COUNT(*)
  FROM `product_units` u
  WHERE u.`product_id` = p.`id`
    AND u.`lifecycle_status` = 'active'
)
WHERE p.`track_units` = 1;
