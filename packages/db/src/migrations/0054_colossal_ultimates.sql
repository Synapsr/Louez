ALTER TABLE `ai_credit_debits` MODIFY COLUMN `conversation_id` varchar(21);--> statement-breakpoint
ALTER TABLE `ai_credit_debits` ADD `kind` enum('usage','number_rental') DEFAULT 'usage' NOT NULL;--> statement-breakpoint
ALTER TABLE `store_phone_numbers` ADD `next_renewal_at` timestamp;--> statement-breakpoint
ALTER TABLE `store_phone_numbers` ADD `renewal_warned_at` timestamp;--> statement-breakpoint
ALTER TABLE `store_phone_numbers` ADD `renewal_failed_at` timestamp;--> statement-breakpoint
ALTER TABLE `store_phone_numbers` ADD `renewal_reminded_at` timestamp;