CREATE TABLE `api_handoffs` (
	`id` varchar(21) NOT NULL,
	`store_id` varchar(21) NOT NULL,
	`kind` varchar(40) NOT NULL,
	`status` enum('pending','opened','completed','failed') NOT NULL DEFAULT 'pending',
	`active_slot` tinyint,
	`user_id` varchar(21) NOT NULL,
	`credential_kind` varchar(16) NOT NULL,
	`credential_id` varchar(64),
	`client_name` varchar(100),
	`token_hash` varchar(64) NOT NULL,
	`link_issued_at` timestamp(3) NOT NULL,
	`expires_at` timestamp(3) NOT NULL,
	`opened_at` timestamp(3),
	`return_state_hash` varchar(64),
	`provider_ref` varchar(255),
	`provider_check_at` timestamp(3),
	`provider_checks` int unsigned NOT NULL DEFAULT 0,
	`completed_at` timestamp(3),
	`failed_at` timestamp(3),
	`failure_code` varchar(60),
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `api_handoffs_id` PRIMARY KEY(`id`),
	CONSTRAINT `api_handoffs_active_unique` UNIQUE(`store_id`,`kind`,`active_slot`),
	CONSTRAINT `api_handoffs_token_unique` UNIQUE(`token_hash`)
);
--> statement-breakpoint
CREATE INDEX `api_handoffs_store_idx` ON `api_handoffs` (`store_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `api_handoffs_updated_idx` ON `api_handoffs` (`updated_at`);