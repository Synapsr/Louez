CREATE TABLE `daily_stats` (
	`id` varchar(21) NOT NULL,
	`store_id` varchar(21) NOT NULL,
	`date` timestamp NOT NULL,
	`page_views` int NOT NULL DEFAULT 0,
	`unique_visitors` int NOT NULL DEFAULT 0,
	`product_views` int NOT NULL DEFAULT 0,
	`cart_additions` int NOT NULL DEFAULT 0,
	`checkout_started` int NOT NULL DEFAULT 0,
	`checkout_completed` int NOT NULL DEFAULT 0,
	`reservations_created` int NOT NULL DEFAULT 0,
	`reservations_confirmed` int NOT NULL DEFAULT 0,
	`revenue` decimal(10,2) NOT NULL DEFAULT '0',
	`average_cart_value` decimal(10,2) DEFAULT '0',
	`mobile_visitors` int NOT NULL DEFAULT 0,
	`tablet_visitors` int NOT NULL DEFAULT 0,
	`desktop_visitors` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `daily_stats_id` PRIMARY KEY(`id`),
	CONSTRAINT `daily_stats_unique_store_date` UNIQUE(`store_id`,`date`)
);
--> statement-breakpoint
CREATE TABLE `page_views` (
	`id` varchar(21) NOT NULL,
	`store_id` varchar(21) NOT NULL,
	`session_id` varchar(36) NOT NULL,
	`page_type` enum('home','catalog','product','cart','checkout','confirmation','account') NOT NULL,
	`product_id` varchar(21),
	`category_id` varchar(21),
	`referrer` varchar(500),
	`device_type` enum('mobile','tablet','desktop') DEFAULT 'desktop',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `page_views_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `product_stats` (
	`id` varchar(21) NOT NULL,
	`store_id` varchar(21) NOT NULL,
	`product_id` varchar(21) NOT NULL,
	`date` timestamp NOT NULL,
	`views` int NOT NULL DEFAULT 0,
	`cart_additions` int NOT NULL DEFAULT 0,
	`reservations` int NOT NULL DEFAULT 0,
	`revenue` decimal(10,2) NOT NULL DEFAULT '0',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `product_stats_id` PRIMARY KEY(`id`),
	CONSTRAINT `product_stats_unique` UNIQUE(`store_id`,`product_id`,`date`)
);
--> statement-breakpoint
CREATE TABLE `storefront_events` (
	`id` varchar(21) NOT NULL,
	`store_id` varchar(21) NOT NULL,
	`session_id` varchar(36) NOT NULL,
	`customer_id` varchar(21),
	`storefront_event_type` enum('add_to_cart','remove_from_cart','update_quantity','checkout_started','checkout_completed','checkout_abandoned','payment_initiated','payment_completed','payment_failed','login_requested','login_completed') NOT NULL,
	`metadata` json,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `storefront_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `daily_stats_store_idx` ON `daily_stats` (`store_id`);--> statement-breakpoint
CREATE INDEX `daily_stats_date_idx` ON `daily_stats` (`date`);--> statement-breakpoint
CREATE INDEX `daily_stats_store_date_idx` ON `daily_stats` (`store_id`,`date`);--> statement-breakpoint
CREATE INDEX `page_views_store_idx` ON `page_views` (`store_id`);--> statement-breakpoint
CREATE INDEX `page_views_session_idx` ON `page_views` (`session_id`);--> statement-breakpoint
CREATE INDEX `page_views_store_created_idx` ON `page_views` (`store_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `page_views_product_idx` ON `page_views` (`product_id`);--> statement-breakpoint
CREATE INDEX `product_stats_store_idx` ON `product_stats` (`store_id`);--> statement-breakpoint
CREATE INDEX `product_stats_product_idx` ON `product_stats` (`product_id`);--> statement-breakpoint
CREATE INDEX `product_stats_date_idx` ON `product_stats` (`date`);--> statement-breakpoint
CREATE INDEX `storefront_events_store_idx` ON `storefront_events` (`store_id`);--> statement-breakpoint
CREATE INDEX `storefront_events_session_idx` ON `storefront_events` (`session_id`);--> statement-breakpoint
CREATE INDEX `storefront_events_store_created_idx` ON `storefront_events` (`store_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `storefront_events_type_idx` ON `storefront_events` (`storefront_event_type`);