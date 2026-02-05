CREATE TABLE `discord_logs` (
	`id` varchar(21) NOT NULL,
	`store_id` varchar(21) NOT NULL,
	`reservation_id` varchar(21),
	`event_type` varchar(50) NOT NULL,
	`status` varchar(20) NOT NULL DEFAULT 'sent',
	`error` text,
	`sent_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `discord_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `stores` ADD `notification_settings` json;--> statement-breakpoint
ALTER TABLE `stores` ADD `discord_webhook_url` varchar(500);--> statement-breakpoint
ALTER TABLE `stores` ADD `owner_phone` varchar(20);