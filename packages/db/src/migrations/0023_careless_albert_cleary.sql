ALTER TABLE `stores` ADD `discount_percent` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `stores` ADD `discount_duration_months` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `stores` ADD `stripe_coupon_id` varchar(255);