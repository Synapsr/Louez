CREATE TABLE `store_phone_numbers` (
	`id` varchar(21) NOT NULL,
	`store_id` varchar(21) NOT NULL,
	`e164` varchar(32) NOT NULL,
	`provider` varchar(20) NOT NULL DEFAULT 'twilio',
	`provider_number_id` varchar(64),
	`status` enum('active','pending','released') NOT NULL DEFAULT 'active',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `store_phone_numbers_id` PRIMARY KEY(`id`),
	CONSTRAINT `store_phone_numbers_e164_unique` UNIQUE(`e164`)
);
--> statement-breakpoint
ALTER TABLE `ai_advisor_conversations` ADD `channel` enum('web','phone') DEFAULT 'web' NOT NULL;--> statement-breakpoint
ALTER TABLE `ai_advisor_conversations` ADD `caller_phone` varchar(32);--> statement-breakpoint
ALTER TABLE `ai_advisor_conversations` ADD `provider_call_id` varchar(64);--> statement-breakpoint
ALTER TABLE `ai_advisor_conversations` ADD `duration_seconds` int;--> statement-breakpoint
ALTER TABLE `ai_credit_debits` ADD `audio_seconds` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `stores` ADD `ai_phone_settings` json;--> statement-breakpoint
CREATE INDEX `store_phone_numbers_store_idx` ON `store_phone_numbers` (`store_id`);--> statement-breakpoint
CREATE INDEX `ai_advisor_conversations_provider_call_idx` ON `ai_advisor_conversations` (`provider_call_id`);