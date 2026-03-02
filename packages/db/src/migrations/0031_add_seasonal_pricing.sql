CREATE TABLE `product_seasonal_pricing` (
	`id` varchar(21) NOT NULL,
	`product_id` varchar(21) NOT NULL,
	`name` varchar(100) NOT NULL,
	`start_date` date NOT NULL,
	`end_date` date NOT NULL,
	`price` decimal(10,2) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `product_seasonal_pricing_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `product_seasonal_pricing_tiers` (
	`id` varchar(21) NOT NULL,
	`seasonal_pricing_id` varchar(21) NOT NULL,
	`min_duration` int,
	`period` int,
	`discount_percent` decimal(10,6),
	`price` decimal(10,2),
	`display_order` int DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `product_seasonal_pricing_tiers_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `product_seasonal_pricing_product_idx` ON `product_seasonal_pricing` (`product_id`);--> statement-breakpoint
CREATE INDEX `product_seasonal_pricing_product_date_idx` ON `product_seasonal_pricing` (`product_id`,`start_date`,`end_date`);--> statement-breakpoint
CREATE INDEX `seasonal_pricing_tiers_seasonal_idx` ON `product_seasonal_pricing_tiers` (`seasonal_pricing_id`);