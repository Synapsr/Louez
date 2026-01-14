CREATE TABLE `accounts` (
	`id` varchar(21) NOT NULL,
	`user_id` varchar(21) NOT NULL,
	`type` varchar(255) NOT NULL,
	`provider` varchar(255) NOT NULL,
	`provider_account_id` varchar(255) NOT NULL,
	`refresh_token` text,
	`access_token` text,
	`expires_at` int,
	`token_type` varchar(255),
	`scope` varchar(255),
	`id_token` text,
	`session_state` varchar(255),
	CONSTRAINT `accounts_id` PRIMARY KEY(`id`),
	CONSTRAINT `accounts_provider_idx` UNIQUE(`provider`,`provider_account_id`)
);
--> statement-breakpoint
CREATE TABLE `categories` (
	`id` varchar(21) NOT NULL,
	`store_id` varchar(21) NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`image_url` text,
	`order` int DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `categories_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `customer_sessions` (
	`id` varchar(21) NOT NULL,
	`customer_id` varchar(21) NOT NULL,
	`token` varchar(255) NOT NULL,
	`expires_at` timestamp NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `customer_sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `customer_sessions_token_unique` UNIQUE(`token`)
);
--> statement-breakpoint
CREATE TABLE `customers` (
	`id` varchar(21) NOT NULL,
	`store_id` varchar(21) NOT NULL,
	`email` varchar(255) NOT NULL,
	`first_name` varchar(255) NOT NULL,
	`last_name` varchar(255) NOT NULL,
	`phone` varchar(50),
	`address` text,
	`city` varchar(255),
	`postal_code` varchar(20),
	`country` varchar(2) DEFAULT 'FR',
	`notes` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `customers_id` PRIMARY KEY(`id`),
	CONSTRAINT `customers_unique_email_per_store` UNIQUE(`store_id`,`email`)
);
--> statement-breakpoint
CREATE TABLE `documents` (
	`id` varchar(21) NOT NULL,
	`reservation_id` varchar(21) NOT NULL,
	`document_type` enum('contract','invoice') NOT NULL,
	`number` varchar(50) NOT NULL,
	`file_url` text NOT NULL,
	`file_name` varchar(255) NOT NULL,
	`generated_at` timestamp NOT NULL DEFAULT (now()),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `documents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `email_logs` (
	`id` varchar(21) NOT NULL,
	`store_id` varchar(21) NOT NULL,
	`reservation_id` varchar(21),
	`customer_id` varchar(21),
	`to` varchar(255) NOT NULL,
	`subject` varchar(500) NOT NULL,
	`template_type` varchar(50) NOT NULL,
	`message_id` varchar(255),
	`status` varchar(20) DEFAULT 'sent',
	`error` text,
	`sent_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `email_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `payments` (
	`id` varchar(21) NOT NULL,
	`reservation_id` varchar(21) NOT NULL,
	`amount` decimal(10,2) NOT NULL,
	`payment_type` enum('rental','deposit','deposit_return','damage') NOT NULL,
	`payment_method` enum('stripe','cash','card','transfer','check','other') NOT NULL,
	`payment_status` enum('pending','completed','failed','refunded') NOT NULL DEFAULT 'pending',
	`stripe_payment_intent_id` varchar(255),
	`stripe_charge_id` varchar(255),
	`notes` text,
	`paid_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `payments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `product_pricing_tiers` (
	`id` varchar(21) NOT NULL,
	`product_id` varchar(21) NOT NULL,
	`min_duration` int NOT NULL,
	`discount_percent` decimal(5,2) NOT NULL,
	`display_order` int DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `product_pricing_tiers_id` PRIMARY KEY(`id`),
	CONSTRAINT `product_pricing_tiers_unique` UNIQUE(`product_id`,`min_duration`)
);
--> statement-breakpoint
CREATE TABLE `products` (
	`id` varchar(21) NOT NULL,
	`store_id` varchar(21) NOT NULL,
	`category_id` varchar(21),
	`name` varchar(255) NOT NULL,
	`description` text,
	`images` json DEFAULT ('[]'),
	`price` decimal(10,2) NOT NULL,
	`deposit` decimal(10,2) DEFAULT '0',
	`pricing_mode` enum('hour','day','week'),
	`video_url` text,
	`quantity` int NOT NULL DEFAULT 1,
	`product_status` enum('draft','active','archived') DEFAULT 'active',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `products_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `reservation_activity` (
	`id` varchar(21) NOT NULL,
	`reservation_id` varchar(21) NOT NULL,
	`user_id` varchar(21),
	`activity_type` enum('created','confirmed','rejected','cancelled','picked_up','returned','note_updated','payment_added','payment_updated') NOT NULL,
	`description` text,
	`metadata` json,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `reservation_activity_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `reservation_items` (
	`id` varchar(21) NOT NULL,
	`reservation_id` varchar(21) NOT NULL,
	`product_id` varchar(21),
	`is_custom_item` boolean NOT NULL DEFAULT false,
	`quantity` int NOT NULL,
	`unit_price` decimal(10,2) NOT NULL,
	`deposit_per_unit` decimal(10,2) NOT NULL,
	`total_price` decimal(10,2) NOT NULL,
	`pricing_breakdown` json,
	`product_snapshot` json NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `reservation_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `reservations` (
	`id` varchar(21) NOT NULL,
	`store_id` varchar(21) NOT NULL,
	`customer_id` varchar(21) NOT NULL,
	`number` varchar(50) NOT NULL,
	`reservation_status` enum('pending','confirmed','ongoing','completed','cancelled','rejected') NOT NULL DEFAULT 'pending',
	`start_date` timestamp NOT NULL,
	`end_date` timestamp NOT NULL,
	`subtotal_amount` decimal(10,2) NOT NULL,
	`deposit_amount` decimal(10,2) NOT NULL,
	`total_amount` decimal(10,2) NOT NULL,
	`signed_at` timestamp,
	`signature_ip` varchar(50),
	`picked_up_at` timestamp,
	`returned_at` timestamp,
	`customer_notes` text,
	`internal_notes` text,
	`source` varchar(20) DEFAULT 'online',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `reservations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`session_token` varchar(255) NOT NULL,
	`user_id` varchar(21) NOT NULL,
	`expires` timestamp NOT NULL,
	CONSTRAINT `sessions_session_token` PRIMARY KEY(`session_token`)
);
--> statement-breakpoint
CREATE TABLE `store_invitations` (
	`id` varchar(21) NOT NULL,
	`store_id` varchar(21) NOT NULL,
	`email` varchar(255) NOT NULL,
	`member_role` enum('owner','member') NOT NULL DEFAULT 'member',
	`token` varchar(64) NOT NULL,
	`invitation_status` enum('pending','accepted','expired','cancelled') NOT NULL DEFAULT 'pending',
	`invited_by` varchar(21) NOT NULL,
	`expires_at` timestamp NOT NULL,
	`accepted_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `store_invitations_id` PRIMARY KEY(`id`),
	CONSTRAINT `store_invitations_token_unique` UNIQUE(`token`)
);
--> statement-breakpoint
CREATE TABLE `store_members` (
	`id` varchar(21) NOT NULL,
	`store_id` varchar(21) NOT NULL,
	`user_id` varchar(21) NOT NULL,
	`member_role` enum('owner','member') NOT NULL DEFAULT 'member',
	`added_by` varchar(21),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `store_members_id` PRIMARY KEY(`id`),
	CONSTRAINT `store_members_unique` UNIQUE(`store_id`,`user_id`)
);
--> statement-breakpoint
CREATE TABLE `stores` (
	`id` varchar(21) NOT NULL,
	`user_id` varchar(21) NOT NULL,
	`name` varchar(255) NOT NULL,
	`slug` varchar(100) NOT NULL,
	`description` text,
	`email` varchar(255),
	`phone` varchar(50),
	`address` text,
	`latitude` decimal(10,7),
	`longitude` decimal(10,7),
	`logo_url` text,
	`settings` json DEFAULT ('{"pricingMode":"day","reservationMode":"payment","minDuration":1,"maxDuration":null,"advanceNotice":24}'),
	`theme` json DEFAULT ('{"mode":"light","primaryColor":"#0066FF"}'),
	`cgv` text,
	`legal_notice` text,
	`stripe_account_id` varchar(255),
	`stripe_onboarding_complete` boolean DEFAULT false,
	`email_settings` json DEFAULT ('{"confirmationEnabled":true,"reminderPickupEnabled":true,"reminderReturnEnabled":true,"replyToEmail":null}'),
	`onboarding_completed` boolean DEFAULT false,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `stores_id` PRIMARY KEY(`id`),
	CONSTRAINT `stores_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `subscription_plans` (
	`id` varchar(21) NOT NULL,
	`name` varchar(100) NOT NULL,
	`slug` varchar(50) NOT NULL,
	`description` text,
	`price` decimal(10,2) NOT NULL,
	`plan_interval` enum('monthly','yearly') NOT NULL DEFAULT 'monthly',
	`features` json NOT NULL,
	`is_popular` boolean DEFAULT false,
	`display_order` int DEFAULT 0,
	`is_active` boolean DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `subscription_plans_id` PRIMARY KEY(`id`),
	CONSTRAINT `subscription_plans_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`id` varchar(21) NOT NULL,
	`store_id` varchar(21) NOT NULL,
	`plan_id` varchar(21) NOT NULL,
	`subscription_status` enum('active','cancelled','past_due','trialing') NOT NULL DEFAULT 'active',
	`current_period_start` timestamp NOT NULL,
	`current_period_end` timestamp NOT NULL,
	`cancel_at_period_end` boolean DEFAULT false,
	`cancelled_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `subscriptions_id` PRIMARY KEY(`id`),
	CONSTRAINT `subscriptions_store_id_unique` UNIQUE(`store_id`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` varchar(21) NOT NULL,
	`email` varchar(255) NOT NULL,
	`name` varchar(255),
	`image` text,
	`email_verified` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_email_unique` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE TABLE `verification_codes` (
	`id` varchar(21) NOT NULL,
	`email` varchar(255) NOT NULL,
	`store_id` varchar(21) NOT NULL,
	`code` varchar(6) NOT NULL,
	`type` varchar(20) NOT NULL,
	`token` varchar(255),
	`expires_at` timestamp NOT NULL,
	`used_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `verification_codes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `verification_tokens` (
	`identifier` varchar(255) NOT NULL,
	`token` varchar(255) NOT NULL,
	`expires` timestamp NOT NULL,
	CONSTRAINT `verification_tokens_identifier_token` UNIQUE(`identifier`,`token`)
);
--> statement-breakpoint
CREATE INDEX `accounts_user_idx` ON `accounts` (`user_id`);--> statement-breakpoint
CREATE INDEX `categories_store_idx` ON `categories` (`store_id`);--> statement-breakpoint
CREATE INDEX `customers_store_idx` ON `customers` (`store_id`);--> statement-breakpoint
CREATE INDEX `customers_email_idx` ON `customers` (`email`);--> statement-breakpoint
CREATE INDEX `payments_reservation_idx` ON `payments` (`reservation_id`);--> statement-breakpoint
CREATE INDEX `product_pricing_tiers_product_idx` ON `product_pricing_tiers` (`product_id`);--> statement-breakpoint
CREATE INDEX `products_store_idx` ON `products` (`store_id`);--> statement-breakpoint
CREATE INDEX `products_category_idx` ON `products` (`category_id`);--> statement-breakpoint
CREATE INDEX `products_status_idx` ON `products` (`product_status`);--> statement-breakpoint
CREATE INDEX `products_store_status_name_idx` ON `products` (`store_id`,`product_status`,`name`);--> statement-breakpoint
CREATE INDEX `reservation_activity_reservation_idx` ON `reservation_activity` (`reservation_id`);--> statement-breakpoint
CREATE INDEX `reservation_activity_user_idx` ON `reservation_activity` (`user_id`);--> statement-breakpoint
CREATE INDEX `reservation_items_reservation_idx` ON `reservation_items` (`reservation_id`);--> statement-breakpoint
CREATE INDEX `reservations_store_idx` ON `reservations` (`store_id`);--> statement-breakpoint
CREATE INDEX `reservations_customer_idx` ON `reservations` (`customer_id`);--> statement-breakpoint
CREATE INDEX `reservations_status_idx` ON `reservations` (`reservation_status`);--> statement-breakpoint
CREATE INDEX `reservations_date_idx` ON `reservations` (`start_date`,`end_date`);--> statement-breakpoint
CREATE INDEX `store_invitations_store_idx` ON `store_invitations` (`store_id`);--> statement-breakpoint
CREATE INDEX `store_invitations_email_idx` ON `store_invitations` (`email`);--> statement-breakpoint
CREATE INDEX `store_invitations_token_idx` ON `store_invitations` (`token`);--> statement-breakpoint
CREATE INDEX `store_members_store_idx` ON `store_members` (`store_id`);--> statement-breakpoint
CREATE INDEX `store_members_user_idx` ON `store_members` (`user_id`);--> statement-breakpoint
CREATE INDEX `stores_slug_idx` ON `stores` (`slug`);--> statement-breakpoint
CREATE INDEX `stores_user_idx` ON `stores` (`user_id`);--> statement-breakpoint
CREATE INDEX `subscriptions_store_idx` ON `subscriptions` (`store_id`);--> statement-breakpoint
CREATE INDEX `subscriptions_plan_idx` ON `subscriptions` (`plan_id`);