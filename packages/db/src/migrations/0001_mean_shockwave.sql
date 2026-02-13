ALTER TABLE `products` ADD `tax_settings` json;--> statement-breakpoint
ALTER TABLE `reservation_items` ADD `tax_rate` decimal(5,2);--> statement-breakpoint
ALTER TABLE `reservation_items` ADD `tax_amount` decimal(10,2);--> statement-breakpoint
ALTER TABLE `reservation_items` ADD `price_excl_tax` decimal(10,2);--> statement-breakpoint
ALTER TABLE `reservation_items` ADD `total_excl_tax` decimal(10,2);--> statement-breakpoint
ALTER TABLE `reservations` ADD `subtotal_excl_tax` decimal(10,2);--> statement-breakpoint
ALTER TABLE `reservations` ADD `tax_amount` decimal(10,2);--> statement-breakpoint
ALTER TABLE `reservations` ADD `tax_rate` decimal(5,2);