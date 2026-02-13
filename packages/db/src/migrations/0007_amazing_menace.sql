CREATE TABLE `google_places_cache` (
	`id` varchar(21) NOT NULL,
	`place_id` varchar(255) NOT NULL,
	`name` varchar(255) NOT NULL,
	`address` text,
	`rating` decimal(2,1),
	`review_count` int,
	`reviews` json,
	`maps_url` text,
	`fetched_at` timestamp NOT NULL DEFAULT (now()),
	`expires_at` timestamp NOT NULL,
	CONSTRAINT `google_places_cache_id` PRIMARY KEY(`id`),
	CONSTRAINT `google_places_cache_place_id_unique` UNIQUE(`place_id`)
);
--> statement-breakpoint
CREATE TABLE `review_request_logs` (
	`id` varchar(21) NOT NULL,
	`reservation_id` varchar(21) NOT NULL,
	`store_id` varchar(21) NOT NULL,
	`customer_id` varchar(21) NOT NULL,
	`review_request_channel` enum('email','sms') NOT NULL,
	`sent_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `review_request_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `stores` ADD `review_booster_settings` json;--> statement-breakpoint
CREATE INDEX `google_places_cache_place_id_idx` ON `google_places_cache` (`place_id`);--> statement-breakpoint
CREATE INDEX `google_places_cache_expires_at_idx` ON `google_places_cache` (`expires_at`);--> statement-breakpoint
CREATE INDEX `review_request_logs_reservation_idx` ON `review_request_logs` (`reservation_id`);--> statement-breakpoint
CREATE INDEX `review_request_logs_store_idx` ON `review_request_logs` (`store_id`);