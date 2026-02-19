CREATE TABLE `sms_logs` (
	`id` varchar(21) NOT NULL,
	`store_id` varchar(21) NOT NULL,
	`reservation_id` varchar(21),
	`customer_id` varchar(21),
	`to` varchar(50) NOT NULL,
	`message` text NOT NULL,
	`template_type` varchar(50) NOT NULL,
	`message_id` varchar(255),
	`status` varchar(20) DEFAULT 'sent',
	`error` text,
	`sent_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `sms_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `payments` MODIFY COLUMN `payment_type` enum('rental','deposit','deposit_hold','deposit_capture','deposit_return','damage','adjustment') NOT NULL;--> statement-breakpoint
ALTER TABLE `reservation_activity` MODIFY COLUMN `activity_type` enum('created','confirmed','rejected','cancelled','picked_up','returned','note_updated','payment_added','payment_updated','payment_received','payment_initiated','payment_failed','payment_expired','deposit_authorized','deposit_captured','deposit_released','deposit_failed','access_link_sent','modified') NOT NULL;