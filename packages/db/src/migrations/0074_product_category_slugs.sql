ALTER TABLE `categories` ADD `slug` varchar(80);--> statement-breakpoint
ALTER TABLE `products` ADD `slug` varchar(80);--> statement-breakpoint
ALTER TABLE `categories` ADD CONSTRAINT `categories_store_slug_idx` UNIQUE(`store_id`,`slug`);--> statement-breakpoint
ALTER TABLE `products` ADD CONSTRAINT `products_store_slug_idx` UNIQUE(`store_id`,`slug`);