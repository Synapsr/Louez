DELETE pa FROM `product_accessories` pa LEFT JOIN `products` parent ON parent.`id` = pa.`product_id` LEFT JOIN `products` accessory ON accessory.`id` = pa.`accessory_id` WHERE parent.`id` IS NULL OR accessory.`id` IS NULL;--> statement-breakpoint
ALTER TABLE `payments` ADD CONSTRAINT `payments_reservation_checkout_session_unique` UNIQUE(`reservation_id`,`stripe_checkout_session_id`);--> statement-breakpoint
ALTER TABLE `product_accessories` ADD CONSTRAINT `product_accessories_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `product_accessories` ADD CONSTRAINT `product_accessories_accessory_id_products_id_fk` FOREIGN KEY (`accessory_id`) REFERENCES `products`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `product_accessories_accessory_idx` ON `product_accessories` (`accessory_id`);
