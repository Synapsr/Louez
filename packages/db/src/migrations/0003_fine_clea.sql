CREATE TABLE `product_accessories` (
	`id` varchar(21) NOT NULL,
	`product_id` varchar(21) NOT NULL,
	`accessory_id` varchar(21) NOT NULL,
	`display_order` int DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `product_accessories_id` PRIMARY KEY(`id`),
	CONSTRAINT `product_accessories_unique` UNIQUE(`product_id`,`accessory_id`)
);
--> statement-breakpoint
ALTER TABLE `payments` MODIFY COLUMN `payment_type` enum('rental','deposit','deposit_hold','deposit_capture','deposit_return','damage') NOT NULL;--> statement-breakpoint
ALTER TABLE `payments` MODIFY COLUMN `payment_status` enum('pending','authorized','completed','failed','cancelled','refunded') NOT NULL DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE `reservation_activity` MODIFY COLUMN `activity_type` enum('created','confirmed','rejected','cancelled','picked_up','returned','note_updated','payment_added','payment_updated','deposit_authorized','deposit_captured','deposit_released','deposit_failed') NOT NULL;--> statement-breakpoint
ALTER TABLE `payments` ADD `stripe_checkout_session_id` varchar(255);--> statement-breakpoint
ALTER TABLE `payments` ADD `stripe_refund_id` varchar(255);--> statement-breakpoint
ALTER TABLE `payments` ADD `stripe_payment_method_id` varchar(255);--> statement-breakpoint
ALTER TABLE `payments` ADD `authorization_expires_at` timestamp;--> statement-breakpoint
ALTER TABLE `payments` ADD `captured_amount` decimal(10,2);--> statement-breakpoint
ALTER TABLE `payments` ADD `currency` varchar(3) DEFAULT 'EUR';--> statement-breakpoint
ALTER TABLE `reservations` ADD `deposit_status` enum('none','pending','card_saved','authorized','captured','released','failed') DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE `reservations` ADD `deposit_payment_intent_id` varchar(255);--> statement-breakpoint
ALTER TABLE `reservations` ADD `deposit_authorization_expires_at` timestamp;--> statement-breakpoint
ALTER TABLE `reservations` ADD `stripe_customer_id` varchar(255);--> statement-breakpoint
ALTER TABLE `reservations` ADD `stripe_payment_method_id` varchar(255);--> statement-breakpoint
ALTER TABLE `stores` ADD `stripe_charges_enabled` boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE `stores` ADD `ics_token` varchar(32);--> statement-breakpoint
CREATE INDEX `product_accessories_product_idx` ON `product_accessories` (`product_id`);