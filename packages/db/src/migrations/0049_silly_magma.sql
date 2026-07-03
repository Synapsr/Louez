-- Existing deployments may contain orphaned assignment rows because this table
-- previously had no foreign keys. Delete only rows whose reservation item or
-- product unit no longer resolves so the new constraints can be added safely.
DELETE riu FROM `reservation_item_units` riu
LEFT JOIN `reservation_items` ri ON ri.`id` = riu.`reservation_item_id`
LEFT JOIN `product_units` pu ON pu.`id` = riu.`product_unit_id`
WHERE ri.`id` IS NULL OR pu.`id` IS NULL;
--> statement-breakpoint
ALTER TABLE `reservation_item_units` ADD CONSTRAINT `reservation_item_units_reservation_item_id_reservation_items_id_fk` FOREIGN KEY (`reservation_item_id`) REFERENCES `reservation_items`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `reservation_item_units` ADD CONSTRAINT `reservation_item_units_product_unit_id_product_units_id_fk` FOREIGN KEY (`product_unit_id`) REFERENCES `product_units`(`id`) ON DELETE restrict ON UPDATE no action;
