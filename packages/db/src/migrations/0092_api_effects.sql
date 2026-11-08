CREATE TABLE `api_effects` (
	`id` varchar(21) NOT NULL,
	`seq` serial AUTO_INCREMENT,
	`store_id` varchar(21) NOT NULL,
	`reservation_id` varchar(21),
	`customer_id` varchar(21),
	`type` varchar(64) NOT NULL,
	`ordering_key` varchar(120),
	`payload` json NOT NULL,
	`status` enum('pending','running','sent','failed','abandoned','cancelled','superseded') NOT NULL DEFAULT 'pending',
	`attempts` int unsigned NOT NULL DEFAULT 0,
	`next_attempt_at` timestamp(3) NOT NULL DEFAULT (now()),
	`locked_until` timestamp(3),
	`claim_token` varchar(32),
	`last_error` varchar(1000),
	`sent_at` timestamp(3),
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `api_effects_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `api_effects_due_idx` ON `api_effects` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `api_effects_age_idx` ON `api_effects` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `api_effects_lease_idx` ON `api_effects` (`status`,`locked_until`);--> statement-breakpoint
CREATE INDEX `api_effects_ordering_idx` ON `api_effects` (`ordering_key`,`seq`);--> statement-breakpoint
CREATE INDEX `api_effects_store_idx` ON `api_effects` (`store_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `api_effects_reservation_idx` ON `api_effects` (`reservation_id`);--> statement-breakpoint
CREATE INDEX `api_effects_customer_idx` ON `api_effects` (`customer_id`);