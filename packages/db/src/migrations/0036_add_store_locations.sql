CREATE TABLE `store_locations` (
  `id` varchar(21) NOT NULL,
  `store_id` varchar(21) NOT NULL,
  `name` varchar(255) NOT NULL,
  `address` text NOT NULL,
  `city` varchar(255),
  `postal_code` varchar(20),
  `country` varchar(2) DEFAULT 'FR',
  `latitude` decimal(10,7),
  `longitude` decimal(10,7),
  `is_active` boolean NOT NULL DEFAULT true,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `store_locations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `store_locations` ADD CONSTRAINT `store_locations_store_id_stores_id_fk` FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX `store_locations_store_idx` ON `store_locations` (`store_id`);
--> statement-breakpoint
CREATE INDEX `store_locations_active_idx` ON `store_locations` (`store_id`,`is_active`);
--> statement-breakpoint
ALTER TABLE `reservations` ADD `pickup_location_id` varchar(21);
--> statement-breakpoint
ALTER TABLE `reservations` ADD `return_location_id` varchar(21);
--> statement-breakpoint
ALTER TABLE `reservations` ADD `pickup_location_snapshot` json;
--> statement-breakpoint
ALTER TABLE `reservations` ADD `return_location_snapshot` json;
