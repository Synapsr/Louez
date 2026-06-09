ALTER TABLE `reminder_logs` DROP INDEX `reminder_logs_unique`;--> statement-breakpoint
ALTER TABLE `reminder_logs` MODIFY COLUMN `reminder_channel` enum('email','sms','discord') NOT NULL;--> statement-breakpoint
ALTER TABLE `reminder_logs` ADD `reminder_audience` enum('customer','admin') DEFAULT 'customer' NOT NULL;--> statement-breakpoint
ALTER TABLE `reminder_logs` ADD CONSTRAINT `reminder_logs_unique` UNIQUE(`reservation_id`,`reminder_type`,`reminder_channel`,`reminder_audience`);
