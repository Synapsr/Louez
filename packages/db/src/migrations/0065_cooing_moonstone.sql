ALTER TABLE `product_accessories` ADD `required` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `product_accessories` ADD `quantity` int DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `stock_kind` enum('returnable','consumable') DEFAULT 'returnable' NOT NULL;--> statement-breakpoint
ALTER TABLE `reservation_items` ADD `consumed_quantity` int DEFAULT 0 NOT NULL;