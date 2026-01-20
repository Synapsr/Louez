CREATE TABLE `reminder_logs` (
	`id` varchar(21) NOT NULL,
	`reservation_id` varchar(21) NOT NULL,
	`store_id` varchar(21) NOT NULL,
	`customer_id` varchar(21) NOT NULL,
	`reminder_type` enum('pickup','return') NOT NULL,
	`reminder_channel` enum('email','sms') NOT NULL,
	`sent_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `reminder_logs_id` PRIMARY KEY(`id`),
	CONSTRAINT `reminder_logs_unique` UNIQUE(`reservation_id`,`reminder_type`,`reminder_channel`)
);
--> statement-breakpoint
CREATE INDEX `reminder_logs_reservation_idx` ON `reminder_logs` (`reservation_id`);--> statement-breakpoint
CREATE INDEX `reminder_logs_store_idx` ON `reminder_logs` (`store_id`);