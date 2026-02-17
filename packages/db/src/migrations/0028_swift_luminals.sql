CREATE TABLE `products_tulip` (
	`id` varchar(21) NOT NULL,
	`product_id` varchar(21) NOT NULL,
	`tulip_product_id` varchar(50) NOT NULL,
	CONSTRAINT `products_tulip_id` PRIMARY KEY(`id`),
	CONSTRAINT `products_tulip_product_idx` UNIQUE(`product_id`)
);
--> statement-breakpoint
ALTER TABLE `reservations` ADD `tulip_contract_id` varchar(50);--> statement-breakpoint
ALTER TABLE `reservations` ADD `tulip_contract_status` varchar(20);--> statement-breakpoint
CREATE INDEX `products_tulip_tulip_product_idx` ON `products_tulip` (`tulip_product_id`);