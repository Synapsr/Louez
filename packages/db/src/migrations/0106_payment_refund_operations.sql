CREATE TABLE `payment_refund_operations` (
	`id` varchar(21) NOT NULL,
	`store_id` varchar(21) NOT NULL,
	`reservation_id` varchar(21) NOT NULL,
	`payment_id` varchar(21) NOT NULL,
	`stripe_account_id` varchar(255) NOT NULL,
	`stripe_charge_id` varchar(255) NOT NULL,
	`amount_minor` bigint NOT NULL,
	`currency` varchar(3) NOT NULL,
	`refund_type` enum('rental','deposit_return') NOT NULL,
	`reason` enum('requested_by_customer','duplicate','fraudulent') NOT NULL,
	`notes` text,
	`status` enum('requested','succeeded','failed') NOT NULL DEFAULT 'requested',
	`failure_code` varchar(64),
	`failure_message` text,
	`stripe_refund_id` varchar(255),
	`refund_payment_id` varchar(21),
	`approval_id` varchar(21),
	`requested_by_user_id` varchar(21),
	`requested_by_credential_id` varchar(64),
	`provider_requested_at` timestamp,
	`claimed_until` timestamp,
	`claim_token` varchar(21),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `payment_refund_operations_id` PRIMARY KEY(`id`),
	CONSTRAINT `payment_refund_operations_stripe_refund_unique` UNIQUE(`stripe_refund_id`),
	CONSTRAINT `payment_refund_operations_approval_unique` UNIQUE(`approval_id`)
);
--> statement-breakpoint
CREATE INDEX `payment_refund_operations_payment_status_idx` ON `payment_refund_operations` (`payment_id`,`status`);--> statement-breakpoint
CREATE INDEX `payment_refund_operations_status_created_idx` ON `payment_refund_operations` (`status`,`created_at`);