CREATE TABLE `ai_advisor_conversations` (
	`id` varchar(21) NOT NULL,
	`store_id` varchar(21) NOT NULL,
	`customer_id` varchar(21),
	`reservation_id` varchar(21),
	`validated_at` timestamp,
	`validated_cart` json,
	`collected_data` json,
	`locale` varchar(10),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ai_advisor_conversations_id` PRIMARY KEY(`id`),
	CONSTRAINT `ai_advisor_conversations_reservation_unique` UNIQUE(`reservation_id`)
);
--> statement-breakpoint
CREATE TABLE `ai_advisor_messages` (
	`id` varchar(21) NOT NULL,
	`conversation_id` varchar(21) NOT NULL,
	`store_id` varchar(21) NOT NULL,
	`role` enum('user','assistant','system','tool') NOT NULL,
	`content` longtext,
	`tool_invocations` json,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ai_advisor_messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `products` ADD `ai_context` text;--> statement-breakpoint
ALTER TABLE `stores` ADD `ai_advisor_settings` json;--> statement-breakpoint
CREATE INDEX `ai_advisor_conversations_store_created_idx` ON `ai_advisor_conversations` (`store_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ai_advisor_conversations_customer_idx` ON `ai_advisor_conversations` (`customer_id`);--> statement-breakpoint
CREATE INDEX `ai_advisor_messages_conversation_created_idx` ON `ai_advisor_messages` (`conversation_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ai_advisor_messages_store_created_idx` ON `ai_advisor_messages` (`store_id`,`created_at`);