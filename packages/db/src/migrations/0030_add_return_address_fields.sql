ALTER TABLE `reservations` ADD `return_address` text;--> statement-breakpoint
ALTER TABLE `reservations` ADD `return_city` varchar(255);--> statement-breakpoint
ALTER TABLE `reservations` ADD `return_postal_code` varchar(20);--> statement-breakpoint
ALTER TABLE `reservations` ADD `return_country` varchar(2);--> statement-breakpoint
ALTER TABLE `reservations` ADD `return_latitude` decimal(10,7);--> statement-breakpoint
ALTER TABLE `reservations` ADD `return_longitude` decimal(10,7);--> statement-breakpoint
ALTER TABLE `reservations` ADD `return_distance_km` decimal(8,2);