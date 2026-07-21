CREATE TABLE `ai_credit_debits` (
	`id` varchar(21) NOT NULL,
	`store_id` varchar(21) NOT NULL,
	`conversation_id` varchar(21) NOT NULL,
	`dedup_key` varchar(120) NOT NULL,
	`input_tokens` int NOT NULL DEFAULT 0,
	`output_tokens` int NOT NULL DEFAULT 0,
	`cached_input_tokens` int NOT NULL DEFAULT 0,
	`cost_micro_usd` bigint NOT NULL DEFAULT 0,
	`debited_micro` bigint NOT NULL DEFAULT 0,
	`from_monthly_micro` bigint NOT NULL DEFAULT 0,
	`from_prepaid_micro` bigint NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ai_credit_debits_id` PRIMARY KEY(`id`),
	CONSTRAINT `ai_credit_debits_dedup_key_unique` UNIQUE(`dedup_key`)
);
--> statement-breakpoint
CREATE TABLE `ai_credit_transactions` (
	`id` varchar(21) NOT NULL,
	`store_id` varchar(21) NOT NULL,
	`ai_credit_txn_type` enum('grant','topup','auto_topup','adjustment') NOT NULL,
	`credits_micro` bigint NOT NULL,
	`amount_cents` int NOT NULL DEFAULT 0,
	`currency` varchar(3) NOT NULL DEFAULT 'eur',
	`dedup_key` varchar(120),
	`stripe_session_id` varchar(255),
	`stripe_payment_intent_id` varchar(255),
	`stripe_invoice_id` varchar(255),
	`ai_credit_txn_status` enum('pending','completed','failed') NOT NULL DEFAULT 'pending',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`completed_at` timestamp,
	CONSTRAINT `ai_credit_transactions_id` PRIMARY KEY(`id`),
	CONSTRAINT `ai_credit_transactions_dedup_key_unique` UNIQUE(`dedup_key`)
);
--> statement-breakpoint
CREATE TABLE `ai_credits` (
	`id` varchar(21) NOT NULL,
	`store_id` varchar(21) NOT NULL,
	`balance_micro` bigint NOT NULL DEFAULT 0,
	`total_granted_micro` bigint NOT NULL DEFAULT 0,
	`total_purchased_micro` bigint NOT NULL DEFAULT 0,
	`total_used_micro` bigint NOT NULL DEFAULT 0,
	`auto_topup_enabled` boolean NOT NULL DEFAULT false,
	`auto_topup_threshold_micro` bigint,
	`auto_topup_credits` int,
	`auto_topup_price_cents` int,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ai_credits_id` PRIMARY KEY(`id`),
	CONSTRAINT `ai_credits_store_id_unique` UNIQUE(`store_id`)
);
--> statement-breakpoint
ALTER TABLE `ai_advisor_conversations` ADD `accrued_credits_micro` bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `ai_credit_debits_store_created_idx` ON `ai_credit_debits` (`store_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ai_credit_debits_conversation_idx` ON `ai_credit_debits` (`conversation_id`);--> statement-breakpoint
CREATE INDEX `ai_credit_txn_store_idx` ON `ai_credit_transactions` (`store_id`);--> statement-breakpoint
CREATE INDEX `ai_credit_txn_status_idx` ON `ai_credit_transactions` (`ai_credit_txn_status`);--> statement-breakpoint
CREATE INDEX `ai_credit_txn_stripe_session_idx` ON `ai_credit_transactions` (`stripe_session_id`);--> statement-breakpoint
CREATE INDEX `ai_credits_store_idx` ON `ai_credits` (`store_id`);