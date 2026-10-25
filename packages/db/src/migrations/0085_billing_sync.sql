-- M1 PR b: the billing sync queue, its state, the policy cache, payment disputes
-- and the payment facts the billing contract needs (louez-billing docs/api, Q3-Q7,
-- Q15, Q23, Q36). Additive only. Every nullable timestamp says NULL explicitly:
-- with explicit_defaults_for_timestamp off, a bare timestamp column becomes
-- NOT NULL with a zero-date default.
CREATE TABLE `billing_policies` (
	`store_id` varchar(32) NOT NULL,
	`version` int unsigned NOT NULL,
	`effective_from` timestamp(3) NOT NULL,
	`body` json NOT NULL,
	`received_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `billing_policies_store_id_version_pk` PRIMARY KEY(`store_id`,`version`)
);
--> statement-breakpoint
CREATE TABLE `billing_sync_handled_requests` (
	`request_id` varchar(64) NOT NULL,
	`handled_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `billing_sync_handled_requests_request_id` PRIMARY KEY(`request_id`)
);
--> statement-breakpoint
CREATE TABLE `billing_sync_manifests` (
	`store_id` varchar(21) NOT NULL,
	`period` varchar(7) NOT NULL,
	`requested_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`sent_at` timestamp(3) NULL,
	`answered_at` timestamp(3) NULL,
	`status` varchar(16),
	`last_error` varchar(1000),
	CONSTRAINT `billing_sync_manifests_store_id_period_pk` PRIMARY KEY(`store_id`,`period`)
);
--> statement-breakpoint
CREATE TABLE `billing_sync_queue` (
	`aggregate_type` enum('store','reservation','legacy_store','legacy_month') NOT NULL,
	`aggregate_id` varchar(40) NOT NULL,
	`store_id` varchar(21) NOT NULL,
	`version` int unsigned NOT NULL DEFAULT 1,
	`delivered_version` int unsigned NOT NULL DEFAULT 0,
	`sent_hash` varchar(64),
	`final_payload` json,
	`status` enum('pending','synced','dead') NOT NULL DEFAULT 'pending',
	`attempt_count` int unsigned NOT NULL DEFAULT 0,
	`failing_since` timestamp(3) NULL,
	`next_attempt_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`last_error` varchar(1000),
	`marked_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `billing_sync_queue_aggregate_type_aggregate_id_pk` PRIMARY KEY(`aggregate_type`,`aggregate_id`),
	INDEX `billing_sync_queue_due_idx` (`status`,`next_attempt_at`),
	INDEX `billing_sync_queue_store_idx` (`store_id`,`status`)
);
--> statement-breakpoint
CREATE TABLE `billing_sync_state` (
	`id` int NOT NULL,
	`last_relay_ok_at` timestamp(3) NULL,
	`consecutive_failures` int NOT NULL DEFAULT 0,
	`server_error_runs` int NOT NULL DEFAULT 0,
	`single_event_mode` boolean NOT NULL DEFAULT false,
	`retry_after_until` timestamp(3) NULL,
	`last_heartbeat_ok_at` timestamp(3) NULL,
	`policies_etag` varchar(64),
	`last_policy_pull_at` timestamp(3) NULL,
	`last_sweep_at` timestamp(3) NULL,
	`gross_backfilled_at` timestamp(3) NULL,
	`pending_request_ids` json,
	`alerts` json,
	`last_error` varchar(1000),
	`updated_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `billing_sync_state_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `payment_disputes` (
	`id` varchar(255) NOT NULL,
	`payment_id` varchar(21) NOT NULL,
	`reservation_id` varchar(21) NOT NULL,
	`amount_minor` bigint NOT NULL,
	`currency` varchar(3) NOT NULL,
	`status` enum('open','won','lost') NOT NULL,
	`stripe_status` varchar(32) NOT NULL,
	`opened_at` timestamp NULL,
	`closed_at` timestamp NULL,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `payment_disputes_id` PRIMARY KEY(`id`),
	INDEX `payment_disputes_payment_idx` (`payment_id`),
	INDEX `payment_disputes_reservation_idx` (`reservation_id`)
);
--> statement-breakpoint
ALTER TABLE `payments`
  ADD `gross_minor` bigint NULL,
  ADD `insurance_share_minor` bigint NULL,
  ADD `origin` enum('checkout','customer_session','payment_request','extension','deposit','manual') NULL,
  ADD `payment_request_id` varchar(21) NULL,
  ADD `stripe_account_id` varchar(255) NULL,
  ADD `app_fee_total_minor` bigint NULL,
  ADD `app_fee_reservation_minor` bigint NULL,
  ADD `app_fee_marketplace_minor` bigint NULL,
  ADD `app_fee_base_minor` bigint NULL,
  ADD `app_fee_policy_scope` enum('store','default','fail_closed','legacy') NULL,
  ADD `app_fee_policy_version` int NULL,
  ADD `app_fee_metadata_version` int NULL;
--> statement-breakpoint
ALTER TABLE `reservations` ADD `currency` varchar(3) NULL;
