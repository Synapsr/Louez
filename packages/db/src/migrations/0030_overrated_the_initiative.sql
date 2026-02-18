ALTER TABLE `product_pricing_tiers` MODIFY COLUMN `min_duration` int;--> statement-breakpoint
ALTER TABLE `product_pricing_tiers` MODIFY COLUMN `discount_percent` decimal(10,6);--> statement-breakpoint
ALTER TABLE `product_pricing_tiers` ADD `period` int;--> statement-breakpoint
ALTER TABLE `product_pricing_tiers` ADD `price` decimal(10,2);--> statement-breakpoint
ALTER TABLE `products` ADD `base_period_minutes` int;--> statement-breakpoint
ALTER TABLE `product_pricing_tiers` ADD CONSTRAINT `product_pricing_tiers_unique_period` UNIQUE(`product_id`,`period`);
