CREATE TABLE `product_bundles` (
	`id` varchar(21) NOT NULL,
	`store_id` varchar(21) NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`image_url` text,
	`is_active` boolean NOT NULL DEFAULT true,
	`display_order` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `product_bundles_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `product_bundle_items` (
	`id` varchar(21) NOT NULL,
	`bundle_id` varchar(21) NOT NULL,
	`product_id` varchar(21) NOT NULL,
	`quantity` int NOT NULL DEFAULT 1,
	`display_order` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `product_bundle_items_id` PRIMARY KEY(`id`),
	CONSTRAINT `product_bundle_items_unique` UNIQUE(`bundle_id`,`product_id`)
);
--> statement-breakpoint
ALTER TABLE `product_bundle_items` ADD CONSTRAINT `product_bundle_items_bundle_id_product_bundles_id_fk` FOREIGN KEY (`bundle_id`) REFERENCES `product_bundles`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `product_bundle_items` ADD CONSTRAINT `product_bundle_items_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX `product_bundles_store_idx` ON `product_bundles` (`store_id`);
--> statement-breakpoint
CREATE INDEX `product_bundles_store_active_idx` ON `product_bundles` (`store_id`,`is_active`);
--> statement-breakpoint
CREATE INDEX `product_bundle_items_bundle_idx` ON `product_bundle_items` (`bundle_id`);
--> statement-breakpoint
CREATE INDEX `product_bundle_items_product_idx` ON `product_bundle_items` (`product_id`);
