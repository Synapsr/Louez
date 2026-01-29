ALTER TABLE `reservations` ADD `delivery_option` varchar(20) DEFAULT 'pickup';--> statement-breakpoint
ALTER TABLE `reservations` ADD `delivery_address` text;--> statement-breakpoint
ALTER TABLE `reservations` ADD `delivery_city` varchar(255);--> statement-breakpoint
ALTER TABLE `reservations` ADD `delivery_postal_code` varchar(20);--> statement-breakpoint
ALTER TABLE `reservations` ADD `delivery_country` varchar(2);--> statement-breakpoint
ALTER TABLE `reservations` ADD `delivery_latitude` decimal(10,7);--> statement-breakpoint
ALTER TABLE `reservations` ADD `delivery_longitude` decimal(10,7);--> statement-breakpoint
ALTER TABLE `reservations` ADD `delivery_distance_km` decimal(8,2);--> statement-breakpoint
ALTER TABLE `reservations` ADD `delivery_fee` decimal(10,2) DEFAULT '0';