CREATE TABLE `admin_digest_logs` (
	`id` varchar(21) NOT NULL,
	`store_id` varchar(21) NOT NULL,
	`digest_date` varchar(10) NOT NULL,
	`reminder_channel` enum('email','sms','discord') NOT NULL,
	`sent_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `admin_digest_logs_id` PRIMARY KEY(`id`),
	CONSTRAINT `admin_digest_logs_unique` UNIQUE(`store_id`,`digest_date`,`reminder_channel`)
);
--> statement-breakpoint
CREATE INDEX `admin_digest_logs_store_idx` ON `admin_digest_logs` (`store_id`);