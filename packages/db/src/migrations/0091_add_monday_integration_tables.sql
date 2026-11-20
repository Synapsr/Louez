CREATE TABLE `store_monday_integrations` (
  `id` varchar(21) NOT NULL,
  `store_id` varchar(21) NOT NULL,
  `enabled` boolean NOT NULL DEFAULT false,
  `api_token_encrypted` text,
  `api_version` varchar(20) NOT NULL DEFAULT '2024-10',
  `board_id` varchar(64),
  `group_id` varchar(64),
  `subitem_board_id` varchar(64),
  `bot_user_id` varchar(64),
  `webhook_secret` varchar(128),
  `column_config` json,
  `status_labels` json,
  `webhook_status_map` json,
  `last_sync_at` timestamp,
  `last_webhook_at` timestamp,
  `last_error` text,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `store_monday_integrations_id` PRIMARY KEY(`id`),
  CONSTRAINT `store_monday_integrations_store_unique` UNIQUE(`store_id`)
);
--> statement-breakpoint
CREATE INDEX `store_monday_integrations_store_idx` ON `store_monday_integrations` (`store_id`);
--> statement-breakpoint
CREATE INDEX `store_monday_integrations_board_idx` ON `store_monday_integrations` (`board_id`);
--> statement-breakpoint
CREATE TABLE `reservation_monday_items` (
  `id` varchar(21) NOT NULL,
  `store_id` varchar(21) NOT NULL,
  `reservation_id` varchar(21) NOT NULL,
  `monday_board_id` varchar(64),
  `monday_item_id` varchar(64),
  `payload_hash` varchar(64),
  `last_pushed_status` varchar(32),
  `sync_status` enum('pending','processing','synced','failed') NOT NULL DEFAULT 'pending',
  `attempt_count` int NOT NULL DEFAULT 0,
  `next_attempt_at` timestamp NOT NULL DEFAULT (now()),
  `last_synced_at` timestamp,
  `last_error` text,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `reservation_monday_items_id` PRIMARY KEY(`id`),
  CONSTRAINT `reservation_monday_items_reservation_unique` UNIQUE(`reservation_id`),
  CONSTRAINT `reservation_monday_items_monday_item_unique` UNIQUE(`monday_item_id`)
);
--> statement-breakpoint
CREATE INDEX `reservation_monday_items_store_idx` ON `reservation_monday_items` (`store_id`);
--> statement-breakpoint
CREATE INDEX `reservation_monday_items_sync_idx` ON `reservation_monday_items` (`sync_status`,`next_attempt_at`);
--> statement-breakpoint
CREATE TABLE `reservation_monday_subitems` (
  `id` varchar(21) NOT NULL,
  `reservation_id` varchar(21) NOT NULL,
  `reservation_item_id` varchar(21) NOT NULL,
  `monday_parent_item_id` varchar(64) NOT NULL,
  `monday_subitem_board_id` varchar(64),
  `monday_subitem_id` varchar(64) NOT NULL,
  `item_kind` enum('product','room') NOT NULL DEFAULT 'product',
  `payload_hash` varchar(64),
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `reservation_monday_subitems_id` PRIMARY KEY(`id`),
  CONSTRAINT `reservation_monday_subitems_reservation_item_unique` UNIQUE(`reservation_item_id`),
  CONSTRAINT `reservation_monday_subitems_monday_subitem_unique` UNIQUE(`monday_subitem_id`)
);
--> statement-breakpoint
CREATE INDEX `reservation_monday_subitems_reservation_idx` ON `reservation_monday_subitems` (`reservation_id`);
--> statement-breakpoint
CREATE INDEX `reservation_monday_subitems_parent_item_idx` ON `reservation_monday_subitems` (`monday_parent_item_id`);
