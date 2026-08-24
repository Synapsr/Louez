CREATE TABLE `invoice_payments` (
	`id` varchar(21) NOT NULL,
	`invoice_id` varchar(21) NOT NULL,
	`payment_id` varchar(21) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `invoice_payments_id` PRIMARY KEY(`id`),
	CONSTRAINT `invoice_payments_invoice_payment_unique` UNIQUE(`invoice_id`,`payment_id`)
);
--> statement-breakpoint
CREATE TABLE `invoice_sequences` (
	`id` varchar(21) NOT NULL,
	`store_id` varchar(21) NOT NULL,
	`series` enum('invoice','credit_note') NOT NULL,
	`year` int NOT NULL,
	`next_number` int NOT NULL DEFAULT 1,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `invoice_sequences_id` PRIMARY KEY(`id`),
	CONSTRAINT `invoice_sequences_store_series_year_unique` UNIQUE(`store_id`,`series`,`year`)
);
--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` varchar(21) NOT NULL,
	`store_id` varchar(21) NOT NULL,
	`reservation_id` varchar(21) NOT NULL,
	`customer_id` varchar(21) NOT NULL,
	`type` enum('invoice','credit_note') NOT NULL,
	`kind` enum('initial','complementary','credit_note') NOT NULL,
	`number` varchar(50) NOT NULL,
	`issue_date` date NOT NULL,
	`currency` varchar(3) NOT NULL,
	`seller_snapshot` json NOT NULL,
	`buyer_snapshot` json NOT NULL,
	`lines` json NOT NULL,
	`vat_breakdown` json NOT NULL,
	`total_excl_tax` decimal(10,2) NOT NULL,
	`total_tax` decimal(10,2) NOT NULL,
	`total_incl_tax` decimal(10,2) NOT NULL,
	`en16931_snapshot` json NOT NULL,
	`document_id` varchar(21) NOT NULL,
	`preceding_invoice_id` varchar(21),
	`processing_rule` enum('b2b','b2c') NOT NULL,
	`transmission_status` enum('not_applicable','pending','sent','validated','rejected','failed') NOT NULL DEFAULT 'not_applicable',
	`super_pdp_invoice_id` varchar(255),
	`attempt_count` int NOT NULL DEFAULT 0,
	`next_attempt_at` timestamp,
	`last_error` text,
	`latest_super_pdp_status` varchar(32),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `invoices_id` PRIMARY KEY(`id`),
	CONSTRAINT `invoices_store_number_unique` UNIQUE(`store_id`,`number`),
	CONSTRAINT `invoices_document_unique` UNIQUE(`document_id`),
	CONSTRAINT `invoices_super_pdp_invoice_unique` UNIQUE(`super_pdp_invoice_id`)
);
--> statement-breakpoint
CREATE TABLE `received_invoices` (
	`id` varchar(21) NOT NULL,
	`store_id` varchar(21) NOT NULL,
	`super_pdp_invoice_id` varchar(255) NOT NULL,
	`seller_name` varchar(255) NOT NULL,
	`seller_identifier` varchar(80) NOT NULL,
	`number` varchar(50) NOT NULL,
	`issue_date` date NOT NULL,
	`total_excl_tax` decimal(10,2) NOT NULL,
	`total_tax` decimal(10,2) NOT NULL,
	`total_incl_tax` decimal(10,2) NOT NULL,
	`currency` varchar(3) NOT NULL,
	`latest_status` varchar(32),
	`our_action` enum('none','acknowledged','accepted','refused') NOT NULL DEFAULT 'none',
	`document_id` varchar(21),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `received_invoices_id` PRIMARY KEY(`id`),
	CONSTRAINT `received_invoices_store_super_pdp_invoice_unique` UNIQUE(`store_id`,`super_pdp_invoice_id`)
);
--> statement-breakpoint
CREATE TABLE `store_legal_profiles` (
	`id` varchar(21) NOT NULL,
	`store_id` varchar(21) NOT NULL,
	`legal_name` varchar(255) NOT NULL,
	`legal_form` varchar(100) NOT NULL,
	`company_number` varchar(64) NOT NULL,
	`company_number_scheme` enum('fr_siren','be_bce'),
	`siret` varchar(14),
	`vat_number` varchar(64),
	`rcs_city` varchar(255),
	`share_capital` decimal(10,2),
	`registered_address` text NOT NULL,
	`registered_address_complement` text,
	`registered_postal_code` varchar(20) NOT NULL,
	`registered_city` varchar(255) NOT NULL,
	`country` varchar(2) NOT NULL,
	`invoicing_enabled` boolean NOT NULL DEFAULT false,
	`vat_regime` enum('monthly','quarterly','simplified','vat_exemption'),
	`has_vat_on_debits` boolean NOT NULL DEFAULT false,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `store_legal_profiles_id` PRIMARY KEY(`id`),
	CONSTRAINT `store_legal_profiles_store_unique` UNIQUE(`store_id`)
);
--> statement-breakpoint
CREATE TABLE `store_super_pdp_integrations` (
	`id` varchar(21) NOT NULL,
	`integration_id` varchar(21) NOT NULL,
	`environment` enum('sandbox','production') NOT NULL DEFAULT 'sandbox',
	`super_pdp_company_id` varchar(255),
	`company_verification_status` varchar(64),
	`directory_entry_id` varchar(255),
	`directory_entry_status` enum('pending','created','error'),
	`send_and_receive` boolean NOT NULL DEFAULT true,
	`last_event_cursor` varchar(255),
	`connected_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `store_super_pdp_integrations_id` PRIMARY KEY(`id`),
	CONSTRAINT `store_super_pdp_integrations_integration_unique` UNIQUE(`integration_id`)
);
--> statement-breakpoint
ALTER TABLE `documents` MODIFY COLUMN `reservation_id` varchar(21);--> statement-breakpoint
ALTER TABLE `customers` ADD `company_number` varchar(64);--> statement-breakpoint
ALTER TABLE `customers` ADD `company_number_scheme` enum('fr_siren','be_bce');--> statement-breakpoint
ALTER TABLE `customers` ADD `vat_number` varchar(64);--> statement-breakpoint
CREATE INDEX `invoice_payments_invoice_idx` ON `invoice_payments` (`invoice_id`);--> statement-breakpoint
CREATE INDEX `invoice_payments_payment_idx` ON `invoice_payments` (`payment_id`);--> statement-breakpoint
CREATE INDEX `invoice_sequences_store_idx` ON `invoice_sequences` (`store_id`);--> statement-breakpoint
CREATE INDEX `invoices_store_idx` ON `invoices` (`store_id`);--> statement-breakpoint
CREATE INDEX `invoices_reservation_idx` ON `invoices` (`reservation_id`);--> statement-breakpoint
CREATE INDEX `invoices_customer_idx` ON `invoices` (`customer_id`);--> statement-breakpoint
CREATE INDEX `invoices_preceding_invoice_idx` ON `invoices` (`preceding_invoice_id`);--> statement-breakpoint
CREATE INDEX `invoices_transmission_idx` ON `invoices` (`transmission_status`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `received_invoices_store_idx` ON `received_invoices` (`store_id`);--> statement-breakpoint
CREATE INDEX `received_invoices_issue_date_idx` ON `received_invoices` (`issue_date`);--> statement-breakpoint
CREATE INDEX `received_invoices_document_idx` ON `received_invoices` (`document_id`);--> statement-breakpoint
CREATE INDEX `store_legal_profiles_store_idx` ON `store_legal_profiles` (`store_id`);--> statement-breakpoint
CREATE INDEX `store_super_pdp_integrations_integration_idx` ON `store_super_pdp_integrations` (`integration_id`);--> statement-breakpoint
CREATE INDEX `store_super_pdp_integrations_company_idx` ON `store_super_pdp_integrations` (`super_pdp_company_id`);