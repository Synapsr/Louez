CREATE TABLE `api_effects` (
	`id` varchar(21) NOT NULL,
	`store_id` varchar(21) NOT NULL,
	`type` varchar(64) NOT NULL,
	`payload` json NOT NULL,
	`status` enum('pending','running','sent','failed','abandoned') NOT NULL DEFAULT 'pending',
	`attempts` int unsigned NOT NULL DEFAULT 0,
	`next_attempt_at` timestamp(3) NOT NULL DEFAULT (now()),
	`locked_until` timestamp(3),
	`last_error` varchar(1000),
	`sent_at` timestamp(3),
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `api_effects_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `api_effects_due_idx` ON `api_effects` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `api_effects_store_idx` ON `api_effects` (`store_id`,`created_at`);