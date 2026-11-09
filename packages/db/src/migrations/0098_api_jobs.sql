CREATE TABLE `api_jobs` (
	`id` varchar(21) NOT NULL,
	`store_id` varchar(21) NOT NULL,
	`kind` varchar(64) NOT NULL,
	`target_id` varchar(21) NOT NULL,
	`status` enum('queued','running','succeeded','failed') NOT NULL DEFAULT 'queued',
	`slot_key` varchar(64) NOT NULL,
	`active_slot` tinyint,
	`input` json NOT NULL,
	`result` json,
	`error` json,
	`attempts` int unsigned NOT NULL DEFAULT 0,
	`next_attempt_at` timestamp(3) NOT NULL DEFAULT (now()),
	`locked_until` timestamp(3),
	`claim_token` varchar(32),
	`operation_id` varchar(21),
	`user_id` varchar(21) NOT NULL,
	`credential_kind` varchar(16) NOT NULL,
	`credential_id` varchar(64),
	`client_name` varchar(100),
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()),
	`started_at` timestamp(3),
	`finished_at` timestamp(3),
	CONSTRAINT `api_jobs_id` PRIMARY KEY(`id`),
	CONSTRAINT `api_jobs_active_unique` UNIQUE(`store_id`,`slot_key`,`active_slot`)
);
--> statement-breakpoint
CREATE INDEX `api_jobs_due_idx` ON `api_jobs` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `api_jobs_lease_idx` ON `api_jobs` (`status`,`locked_until`);--> statement-breakpoint
CREATE INDEX `api_jobs_store_idx` ON `api_jobs` (`store_id`,`status`,`finished_at`);--> statement-breakpoint
CREATE INDEX `api_jobs_finished_idx` ON `api_jobs` (`finished_at`);