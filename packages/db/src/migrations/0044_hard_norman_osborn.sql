CREATE TABLE `push_subscriptions` (
	`id` varchar(21) NOT NULL,
	`user_id` varchar(21) NOT NULL,
	`store_id` varchar(21),
	`endpoint` text NOT NULL,
	`endpoint_hash` varchar(64) NOT NULL,
	`p256dh` varchar(255) NOT NULL,
	`auth` varchar(255) NOT NULL,
	`user_agent` text,
	`failure_count` int NOT NULL DEFAULT 0,
	`last_success_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `push_subscriptions_id` PRIMARY KEY(`id`),
	CONSTRAINT `push_subscriptions_endpoint_unique` UNIQUE(`endpoint_hash`)
);
--> statement-breakpoint
CREATE INDEX `push_subscriptions_user_idx` ON `push_subscriptions` (`user_id`);--> statement-breakpoint
CREATE INDEX `push_subscriptions_store_idx` ON `push_subscriptions` (`store_id`);