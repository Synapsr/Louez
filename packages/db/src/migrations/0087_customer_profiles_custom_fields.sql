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
ALTER TABLE `customers` ADD `birth_date` date;--> statement-breakpoint
ALTER TABLE `customers` ADD `acquisition_source` enum('word_of_mouth','search_engine','social_media','walk_in','partner','ads','returning','other');--> statement-breakpoint
ALTER TABLE `customers` ADD `acquisition_source_detail` varchar(255);--> statement-breakpoint
ALTER TABLE `customers` ADD `created_via` enum('dashboard','storefront','marketplace','import','api','ai');--> statement-breakpoint
ALTER TABLE `customers` ADD `social_links` json;--> statement-breakpoint
CREATE INDEX `customer_field_definitions_store_idx` ON `customer_field_definitions` (`store_id`,`position`);--> statement-breakpoint
CREATE INDEX `customer_field_values_store_search_idx` ON `customer_field_values` (`store_id`,`search_value`);--> statement-breakpoint
CREATE INDEX `customer_field_values_definition_idx` ON `customer_field_values` (`definition_id`);--> statement-breakpoint
CREATE INDEX `customers_store_created_idx` ON `customers` (`store_id`,`created_at`);