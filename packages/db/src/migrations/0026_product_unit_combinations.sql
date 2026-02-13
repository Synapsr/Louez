ALTER TABLE `products` ADD `booking_attribute_axes` json;--> statement-breakpoint
ALTER TABLE `product_units` ADD `attributes` json;--> statement-breakpoint
ALTER TABLE `product_units` ADD `combination_key` varchar(255) NOT NULL DEFAULT '__default';--> statement-breakpoint
ALTER TABLE `product_units` ADD INDEX `product_units_status_combination_idx` (`product_id`,`unit_status`,`combination_key`);--> statement-breakpoint
ALTER TABLE `reservation_items` ADD `combination_key` varchar(255);--> statement-breakpoint
ALTER TABLE `reservation_items` ADD `selected_attributes` json;--> statement-breakpoint
ALTER TABLE `reservation_items` ADD INDEX `reservation_items_product_combination_idx` (`product_id`,`combination_key`);--> statement-breakpoint
UPDATE `reservation_items` ri
LEFT JOIN `products` p ON p.`id` = ri.`product_id`
SET ri.`combination_key` = '__default'
WHERE
	ri.`is_custom_item` = 0
	AND ri.`product_id` IS NOT NULL
	AND ri.`combination_key` IS NULL
	AND p.`track_units` = 1;
