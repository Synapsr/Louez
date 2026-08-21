ALTER TABLE `payments` ADD `refund_of_payment_id` varchar(21);--> statement-breakpoint
CREATE INDEX `payments_refund_of_payment_idx` ON `payments` (`refund_of_payment_id`);