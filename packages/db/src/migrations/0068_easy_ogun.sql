CREATE TABLE `legal_retention_records` (
	`id` varchar(21) NOT NULL,
	`retention_group_id` varchar(21) NOT NULL,
	`legal_retention_source_type` enum('platform_invoice') NOT NULL,
	`source_record_hash` varchar(64) NOT NULL,
	`document_number` varchar(255),
	`issued_at` date NOT NULL,
	`retain_until` date NOT NULL,
	`legal_basis` varchar(100) NOT NULL DEFAULT 'fr_code_commerce_l123_22',
	`encrypted_payload` longtext NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `legal_retention_records_id` PRIMARY KEY(`id`),
	CONSTRAINT `legal_retention_source_unique` UNIQUE(`legal_retention_source_type`,`source_record_hash`)
);
--> statement-breakpoint
CREATE INDEX `legal_retention_group_idx` ON `legal_retention_records` (`retention_group_id`);--> statement-breakpoint
CREATE INDEX `legal_retention_until_idx` ON `legal_retention_records` (`retain_until`);
