CREATE TABLE `store_integrations` (
  `id` varchar(21) NOT NULL,
  `store_id` varchar(21) NOT NULL,
  `provider_key` varchar(80) NOT NULL,
  `category` varchar(60) NOT NULL,
  `enabled` boolean NOT NULL DEFAULT false,
  `connected_by_user_id` varchar(21),
  `provider_account_email` varchar(255),
  `status` enum('disabled','active','needs_reconnect','error','syncing') NOT NULL DEFAULT 'disabled',
  `last_health_check_at` timestamp,
  `last_error_code` varchar(120),
  `last_error_message` text,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `store_integrations_id` PRIMARY KEY(`id`),
  CONSTRAINT `store_integrations_store_provider_unique` UNIQUE(`store_id`,`provider_key`)
);
--> statement-breakpoint
CREATE INDEX `store_integrations_store_idx` ON `store_integrations` (`store_id`);
--> statement-breakpoint
CREATE INDEX `store_integrations_provider_idx` ON `store_integrations` (`provider_key`);
--> statement-breakpoint
CREATE INDEX `store_integrations_status_idx` ON `store_integrations` (`status`);
--> statement-breakpoint
CREATE TABLE `integration_credentials` (
  `id` varchar(21) NOT NULL,
  `integration_id` varchar(21) NOT NULL,
  `credential_kind` enum('oauth','api_key') NOT NULL DEFAULT 'oauth',
  `access_token_encrypted` text,
  `refresh_token_encrypted` text,
  `expires_at` timestamp,
  `scopes` text,
  `key_version` int NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `integration_credentials_id` PRIMARY KEY(`id`),
  CONSTRAINT `integration_credentials_integration_unique` UNIQUE(`integration_id`)
);
--> statement-breakpoint
CREATE INDEX `integration_credentials_integration_idx` ON `integration_credentials` (`integration_id`);
--> statement-breakpoint
CREATE TABLE `store_calendar_integrations` (
  `id` varchar(21) NOT NULL,
  `integration_id` varchar(21) NOT NULL,
  `calendar_id` varchar(255),
  `calendar_name` varchar(255),
  `sync_pending_reservations` boolean NOT NULL DEFAULT true,
  `cancelled_reservation_behavior` enum('show','hide') NOT NULL DEFAULT 'show',
  `backfill_months` int NOT NULL DEFAULT 12,
  `backfill_past_days` int NOT NULL DEFAULT 30,
  `last_sync_at` timestamp,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `store_calendar_integrations_id` PRIMARY KEY(`id`),
  CONSTRAINT `store_calendar_integrations_integration_unique` UNIQUE(`integration_id`)
);
--> statement-breakpoint
CREATE INDEX `store_calendar_integrations_integration_idx` ON `store_calendar_integrations` (`integration_id`);
--> statement-breakpoint
CREATE TABLE `reservation_calendar_events` (
  `id` varchar(21) NOT NULL,
  `reservation_id` varchar(21) NOT NULL,
  `integration_id` varchar(21) NOT NULL,
  `provider_event_id` varchar(255),
  `payload_hash` varchar(64),
  `sync_status` enum('pending','synced','failed') NOT NULL DEFAULT 'pending',
  `attempt_count` int NOT NULL DEFAULT 0,
  `next_attempt_at` timestamp NOT NULL DEFAULT (now()),
  `last_synced_at` timestamp,
  `last_error` text,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `reservation_calendar_events_id` PRIMARY KEY(`id`),
  CONSTRAINT `reservation_calendar_events_reservation_integration_unique` UNIQUE(`reservation_id`,`integration_id`)
);
--> statement-breakpoint
CREATE INDEX `reservation_calendar_events_reservation_idx` ON `reservation_calendar_events` (`reservation_id`);
--> statement-breakpoint
CREATE INDEX `reservation_calendar_events_integration_idx` ON `reservation_calendar_events` (`integration_id`);
--> statement-breakpoint
CREATE INDEX `reservation_calendar_events_sync_idx` ON `reservation_calendar_events` (`sync_status`,`next_attempt_at`);
