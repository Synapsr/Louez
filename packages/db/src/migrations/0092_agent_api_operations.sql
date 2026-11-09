CREATE TABLE `api_confirmations` (
	`id` varchar(64) NOT NULL,
	`store_id` varchar(21) NOT NULL,
	`procedure` varchar(120) NOT NULL,
	`binding_hash` char(64) NOT NULL,
	`expires_at` timestamp NOT NULL,
	`consumed_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `api_confirmations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `api_operations` (
	`id` varchar(21) NOT NULL,
	`store_id` varchar(21) NOT NULL,
	`user_id` varchar(21) NOT NULL,
	`credential_kind` enum('session','api_key','oauth') NOT NULL,
	`credential_id` varchar(64),
	`client_name` varchar(100),
	`transport` enum('rpc','openapi','mcp') NOT NULL,
	`procedure` varchar(120) NOT NULL,
	`actor_key` varchar(64) NOT NULL,
	`idempotency_key` varchar(100),
	`input_hash` char(64) NOT NULL,
	`status` enum('running','succeeded','failed','unknown') NOT NULL,
	`target_id` varchar(64),
	`result` json,
	`error` json,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `api_operations_id` PRIMARY KEY(`id`),
	CONSTRAINT `api_operations_idempotency_unique` UNIQUE(`store_id`,`actor_key`,`idempotency_key`)
);
--> statement-breakpoint
CREATE TABLE `api_rate_limits` (
	`key` varchar(191) NOT NULL,
	`window_start` bigint NOT NULL,
	`count` int NOT NULL,
	CONSTRAINT `api_rate_limits_key` PRIMARY KEY(`key`)
);
--> statement-breakpoint
ALTER TABLE `api_keys` ADD `confirm_sensitive` boolean DEFAULT true NOT NULL;--> statement-breakpoint
CREATE INDEX `api_confirmations_expires_idx` ON `api_confirmations` (`expires_at`);--> statement-breakpoint
CREATE INDEX `api_operations_store_created_idx` ON `api_operations` (`store_id`,`created_at`);