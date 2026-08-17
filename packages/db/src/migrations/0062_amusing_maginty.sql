CREATE TABLE `marketplace_catalog_tombstones` (
	`id` varchar(21) NOT NULL,
	`entity_type` enum('store','product') NOT NULL,
	`entity_id` varchar(21) NOT NULL,
	`deleted_at` timestamp NOT NULL DEFAULT (now()),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `marketplace_catalog_tombstones_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `store_marketplace_category_mappings` (
	`id` varchar(21) NOT NULL,
	`store_id` varchar(21) NOT NULL,
	`category_id` varchar(21) NOT NULL,
	`marketplace_category_slug` varchar(160) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `store_marketplace_category_mappings_id` PRIMARY KEY(`id`),
	CONSTRAINT `store_marketplace_category_mappings_store_category_unique` UNIQUE(`store_id`,`category_id`)
);
--> statement-breakpoint
CREATE TABLE `store_marketplace_channels` (
	`id` varchar(21) NOT NULL,
	`store_id` varchar(21) NOT NULL,
	`enabled_by_owner` boolean NOT NULL DEFAULT false,
	`status` enum('setup_required','pending','published','paused','disabled') NOT NULL DEFAULT 'setup_required',
	`published_at` timestamp,
	`disabled_at` timestamp,
	`terms_accepted_at` timestamp,
	`status_reason` varchar(255),
	`version` int NOT NULL DEFAULT 1,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `store_marketplace_channels_id` PRIMARY KEY(`id`),
	CONSTRAINT `store_marketplace_channels_store_id_unique` UNIQUE(`store_id`)
);
--> statement-breakpoint
CREATE INDEX `marketplace_catalog_tombstones_deleted_at_id_idx` ON `marketplace_catalog_tombstones` (`deleted_at`,`id`);--> statement-breakpoint
CREATE INDEX `marketplace_catalog_tombstones_entity_idx` ON `marketplace_catalog_tombstones` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `store_marketplace_category_mappings_store_idx` ON `store_marketplace_category_mappings` (`store_id`);--> statement-breakpoint
CREATE INDEX `store_marketplace_category_mappings_category_idx` ON `store_marketplace_category_mappings` (`category_id`);--> statement-breakpoint
CREATE INDEX `store_marketplace_channels_store_idx` ON `store_marketplace_channels` (`store_id`);--> statement-breakpoint
CREATE INDEX `store_marketplace_channels_status_updated_idx` ON `store_marketplace_channels` (`status`,`updated_at`);