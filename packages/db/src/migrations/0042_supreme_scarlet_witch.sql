CREATE TABLE `pay_as_you_go_invoices` (
	`id` varchar(21) NOT NULL,
	`store_id` varchar(21) NOT NULL,
	`billing_month` varchar(7) NOT NULL,
	`location_count` int NOT NULL DEFAULT 0,
	`gross_amount_cents` int NOT NULL DEFAULT 0,
	`collected_at_source_cents` int NOT NULL DEFAULT 0,
	`invoiced_amount_cents` int NOT NULL DEFAULT 0,
	`currency` varchar(3) NOT NULL DEFAULT 'eur',
	`payg_invoice_status` enum('draft','open','paid','failed','void') NOT NULL DEFAULT 'draft',
	`stripe_invoice_id` varchar(255),
	`stripe_customer_id` varchar(255),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`paid_at` timestamp,
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `pay_as_you_go_invoices_id` PRIMARY KEY(`id`),
	CONSTRAINT `payg_invoices_store_month_unique` UNIQUE(`store_id`,`billing_month`)
);
--> statement-breakpoint
CREATE TABLE `pay_as_you_go_usage` (
	`id` varchar(21) NOT NULL,
	`store_id` varchar(21) NOT NULL,
	`reservation_id` varchar(21) NOT NULL,
	`billing_month` varchar(7) NOT NULL,
	`monthly_index` int NOT NULL,
	`amount_cents` int NOT NULL,
	`currency` varchar(3) NOT NULL DEFAULT 'eur',
	`payg_usage_source` enum('online','manual') NOT NULL,
	`payg_usage_status` enum('pending','collected','billed','voided','reversed') NOT NULL,
	`stripe_payment_intent_id` varchar(255),
	`stripe_application_fee_id` varchar(255),
	`invoice_id` varchar(21),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`billed_at` timestamp,
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `pay_as_you_go_usage_id` PRIMARY KEY(`id`),
	CONSTRAINT `pay_as_you_go_usage_reservation_id_unique` UNIQUE(`reservation_id`)
);
--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `billing_mode` enum('subscription','pay_as_you_go') DEFAULT 'subscription' NOT NULL;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `pay_as_you_go_config` json;--> statement-breakpoint
CREATE INDEX `payg_invoices_status_idx` ON `pay_as_you_go_invoices` (`payg_invoice_status`);--> statement-breakpoint
CREATE INDEX `payg_invoices_stripe_invoice_idx` ON `pay_as_you_go_invoices` (`stripe_invoice_id`);--> statement-breakpoint
CREATE INDEX `payg_usage_store_month_idx` ON `pay_as_you_go_usage` (`store_id`,`billing_month`);--> statement-breakpoint
CREATE INDEX `payg_usage_status_idx` ON `pay_as_you_go_usage` (`payg_usage_status`);--> statement-breakpoint
CREATE INDEX `payg_usage_payment_intent_idx` ON `pay_as_you_go_usage` (`stripe_payment_intent_id`);
