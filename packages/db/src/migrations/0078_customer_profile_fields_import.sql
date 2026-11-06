CREATE TABLE `auth_rate_limits` (
	`id` varchar(21) NOT NULL,
	`key` varchar(255) NOT NULL,
	`count` int NOT NULL,
	`last_request` bigint NOT NULL,
	CONSTRAINT `auth_rate_limits_id` PRIMARY KEY(`id`),
	CONSTRAINT `auth_rate_limits_key_unique` UNIQUE(`key`)
);
--> statement-breakpoint
CREATE TABLE `customer_field_definitions` (
	`id` varchar(21) NOT NULL,
	`store_id` varchar(21) NOT NULL,
	`key` varchar(64) NOT NULL,
	`label` varchar(100) NOT NULL,
	`field_type` enum('text','textarea','number','date','select','checkbox','phone','email','url') NOT NULL,
	`format` varchar(32),
	`options` json,
	`unit` varchar(32),
	`help_text` varchar(255),
	`section` varchar(100) NOT NULL,
	`position` int NOT NULL DEFAULT 0,
	`applies_to` enum('all','individual','business') NOT NULL DEFAULT 'all',
	`is_required` boolean NOT NULL DEFAULT false,
	`is_sensitive` boolean NOT NULL DEFAULT false,
	`show_on_contract` boolean NOT NULL DEFAULT false,
	`is_searchable` boolean NOT NULL DEFAULT false,
	`show_in_list` boolean NOT NULL DEFAULT false,
	`template_key` varchar(64),
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `customer_field_definitions_id` PRIMARY KEY(`id`),
	CONSTRAINT `customer_field_definitions_store_key_unique` UNIQUE(`store_id`,`key`)
);
--> statement-breakpoint
CREATE TABLE `customer_field_values` (
	`id` varchar(21) NOT NULL,
	`store_id` varchar(21) NOT NULL,
	`customer_id` varchar(21) NOT NULL,
	`definition_id` varchar(21) NOT NULL,
	`value` varchar(2000) NOT NULL,
	`search_value` varchar(191),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `customer_field_values_id` PRIMARY KEY(`id`),
	CONSTRAINT `customer_field_values_customer_definition_unique` UNIQUE(`customer_id`,`definition_id`)
);
--> statement-breakpoint
CREATE TABLE `import_records` (
	`id` varchar(21) NOT NULL,
	`store_id` varchar(21) NOT NULL,
	`source` varchar(64) NOT NULL,
	`entity_type` enum('customers','products') NOT NULL,
	`external_id` varchar(191) NOT NULL,
	`entity_id` varchar(21) NOT NULL,
	`run_id` varchar(21) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `import_records_id` PRIMARY KEY(`id`),
	CONSTRAINT `import_records_external_unique` UNIQUE(`store_id`,`source`,`entity_type`,`external_id`)
);
--> statement-breakpoint
CREATE TABLE `import_rows` (
	`id` varchar(21) NOT NULL,
	`run_id` varchar(21) NOT NULL,
	`store_id` varchar(21) NOT NULL,
	`row_index` int NOT NULL,
	`payload` json NOT NULL,
	`row_status` enum('pending','created','updated','skipped','error') NOT NULL DEFAULT 'pending',
	`errors` json,
	`entity_id` varchar(21),
	`previous_values` json,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `import_rows_id` PRIMARY KEY(`id`),
	CONSTRAINT `import_rows_run_row_unique` UNIQUE(`run_id`,`row_index`)
);
--> statement-breakpoint
CREATE TABLE `import_runs` (
	`id` varchar(21) NOT NULL,
	`store_id` varchar(21) NOT NULL,
	`entity_type` enum('customers','products') NOT NULL,
	`source` varchar(64) NOT NULL,
	`file_name` varchar(255),
	`import_status` enum('draft','ready','running','completed','failed','reverted') NOT NULL DEFAULT 'draft',
	`duplicate_strategy` enum('fill_empty','overwrite','skip') NOT NULL DEFAULT 'fill_empty',
	`mapping` json,
	`counts` json,
	`created_by_user_id` varchar(21),
	`started_at` timestamp,
	`completed_at` timestamp,
	`reverted_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `import_runs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `customers` ADD `birth_date` date;--> statement-breakpoint
ALTER TABLE `customers` ADD `acquisition_source` enum('word_of_mouth','search_engine','social_media','walk_in','partner','ads','returning','other');--> statement-breakpoint
ALTER TABLE `customers` ADD `acquisition_source_detail` varchar(255);--> statement-breakpoint
ALTER TABLE `customers` ADD `created_via` enum('dashboard','storefront','marketplace','import','api','ai');--> statement-breakpoint
ALTER TABLE `customers` ADD `social_links` json;--> statement-breakpoint
CREATE INDEX `customer_field_definitions_store_idx` ON `customer_field_definitions` (`store_id`,`position`);--> statement-breakpoint
CREATE INDEX `customer_field_values_store_search_idx` ON `customer_field_values` (`store_id`,`search_value`);--> statement-breakpoint
CREATE INDEX `customer_field_values_definition_idx` ON `customer_field_values` (`definition_id`);--> statement-breakpoint
CREATE INDEX `import_records_entity_idx` ON `import_records` (`entity_id`);--> statement-breakpoint
CREATE INDEX `import_records_run_idx` ON `import_records` (`run_id`);--> statement-breakpoint
CREATE INDEX `import_rows_run_status_idx` ON `import_rows` (`run_id`,`row_status`);--> statement-breakpoint
CREATE INDEX `import_runs_store_idx` ON `import_runs` (`store_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `import_runs_status_idx` ON `import_runs` (`import_status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `customers_store_created_idx` ON `customers` (`store_id`,`created_at`);