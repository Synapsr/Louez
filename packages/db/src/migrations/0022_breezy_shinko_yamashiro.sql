CREATE TABLE `inspection_field_values` (
	`id` varchar(21) NOT NULL,
	`inspection_item_id` varchar(21) NOT NULL,
	`template_field_id` varchar(21) NOT NULL,
	`field_snapshot` json NOT NULL,
	`checkbox_value` boolean,
	`rating_value` int,
	`text_value` text,
	`number_value` decimal(15,4),
	`select_value` varchar(255),
	`has_issue` boolean NOT NULL DEFAULT false,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `inspection_field_values_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `inspection_items` (
	`id` varchar(21) NOT NULL,
	`inspection_id` varchar(21) NOT NULL,
	`reservation_item_id` varchar(21) NOT NULL,
	`product_unit_id` varchar(21),
	`product_snapshot` json NOT NULL,
	`condition_rating` enum('excellent','good','fair','damaged'),
	`notes` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `inspection_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `inspection_photos` (
	`id` varchar(21) NOT NULL,
	`inspection_item_id` varchar(21) NOT NULL,
	`field_value_id` varchar(21),
	`photo_key` varchar(255) NOT NULL,
	`photo_url` text NOT NULL,
	`thumbnail_key` varchar(255),
	`thumbnail_url` text,
	`caption` text,
	`display_order` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `inspection_photos_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `inspection_template_fields` (
	`id` varchar(21) NOT NULL,
	`template_id` varchar(21) NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`inspection_field_type` enum('checkbox','rating','text','number','select') NOT NULL,
	`options` json,
	`rating_min` int DEFAULT 1,
	`rating_max` int DEFAULT 5,
	`number_unit` varchar(50),
	`is_required` boolean NOT NULL DEFAULT false,
	`section_name` varchar(100),
	`display_order` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `inspection_template_fields_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `inspection_templates` (
	`id` varchar(21) NOT NULL,
	`store_id` varchar(21) NOT NULL,
	`inspection_template_scope` enum('store','category','product') NOT NULL,
	`category_id` varchar(21),
	`product_id` varchar(21),
	`name` varchar(255) NOT NULL,
	`description` text,
	`is_active` boolean NOT NULL DEFAULT true,
	`display_order` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `inspection_templates_id` PRIMARY KEY(`id`),
	CONSTRAINT `inspection_templates_unique_scope` UNIQUE(`store_id`,`inspection_template_scope`,`category_id`,`product_id`)
);
--> statement-breakpoint
CREATE TABLE `inspections` (
	`id` varchar(21) NOT NULL,
	`store_id` varchar(21) NOT NULL,
	`reservation_id` varchar(21) NOT NULL,
	`inspection_type` enum('departure','return') NOT NULL,
	`inspection_status` enum('draft','completed','signed') NOT NULL DEFAULT 'draft',
	`template_id` varchar(21),
	`template_snapshot` json,
	`notes` text,
	`performed_by_id` varchar(21),
	`performed_at` timestamp,
	`customer_signature` longtext,
	`signed_at` timestamp,
	`signature_ip` varchar(50),
	`has_damage` boolean NOT NULL DEFAULT false,
	`damage_description` text,
	`estimated_damage_cost` decimal(10,2),
	`damage_payment_id` varchar(21),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `inspections_id` PRIMARY KEY(`id`),
	CONSTRAINT `inspections_unique_type` UNIQUE(`reservation_id`,`inspection_type`)
);
--> statement-breakpoint
ALTER TABLE `reservation_activity` MODIFY COLUMN `activity_type` enum('created','confirmed','rejected','cancelled','picked_up','returned','note_updated','payment_added','payment_updated','payment_received','payment_initiated','payment_failed','payment_expired','deposit_authorized','deposit_captured','deposit_released','deposit_failed','access_link_sent','modified','inspection_departure_started','inspection_departure_completed','inspection_return_started','inspection_return_completed','inspection_damage_detected','inspection_signed') NOT NULL;--> statement-breakpoint
CREATE INDEX `inspection_field_values_item_idx` ON `inspection_field_values` (`inspection_item_id`);--> statement-breakpoint
CREATE INDEX `inspection_field_values_field_idx` ON `inspection_field_values` (`template_field_id`);--> statement-breakpoint
CREATE INDEX `inspection_field_values_issue_idx` ON `inspection_field_values` (`inspection_item_id`,`has_issue`);--> statement-breakpoint
CREATE INDEX `inspection_items_inspection_idx` ON `inspection_items` (`inspection_id`);--> statement-breakpoint
CREATE INDEX `inspection_items_reservation_item_idx` ON `inspection_items` (`reservation_item_id`);--> statement-breakpoint
CREATE INDEX `inspection_items_unit_idx` ON `inspection_items` (`product_unit_id`);--> statement-breakpoint
CREATE INDEX `inspection_photos_item_idx` ON `inspection_photos` (`inspection_item_id`);--> statement-breakpoint
CREATE INDEX `inspection_photos_field_value_idx` ON `inspection_photos` (`field_value_id`);--> statement-breakpoint
CREATE INDEX `inspection_template_fields_template_idx` ON `inspection_template_fields` (`template_id`);--> statement-breakpoint
CREATE INDEX `inspection_template_fields_order_idx` ON `inspection_template_fields` (`template_id`,`display_order`);--> statement-breakpoint
CREATE INDEX `inspection_templates_store_idx` ON `inspection_templates` (`store_id`);--> statement-breakpoint
CREATE INDEX `inspection_templates_category_idx` ON `inspection_templates` (`category_id`);--> statement-breakpoint
CREATE INDEX `inspection_templates_product_idx` ON `inspection_templates` (`product_id`);--> statement-breakpoint
CREATE INDEX `inspections_store_idx` ON `inspections` (`store_id`);--> statement-breakpoint
CREATE INDEX `inspections_reservation_idx` ON `inspections` (`reservation_id`);