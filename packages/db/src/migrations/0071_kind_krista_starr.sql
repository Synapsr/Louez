CREATE TABLE `customer_communication_preferences` (
	`id` varchar(21) NOT NULL,
	`store_id` varchar(21) NOT NULL,
	`customer_id` varchar(21) NOT NULL,
	`email_reminders` boolean NOT NULL DEFAULT true,
	`sms_reminders` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `customer_communication_preferences_id` PRIMARY KEY(`id`),
	CONSTRAINT `customer_communication_preferences_customer_store_unique` UNIQUE(`customer_id`,`store_id`)
);
