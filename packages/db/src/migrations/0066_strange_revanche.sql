ALTER TABLE `platform_fee` MODIFY COLUMN `platform_fee_source` enum('online','manual','free','marketplace_online','marketplace_manual','marketplace_waived') NOT NULL;--> statement-breakpoint
ALTER TABLE `pay_as_you_go_invoices` ADD `usage_location_count` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `pay_as_you_go_invoices` ADD `usage_fee_amount_cents` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `pay_as_you_go_invoices` ADD `marketplace_reservation_count` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `pay_as_you_go_invoices` ADD `marketplace_fee_amount_cents` int DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `pay_as_you_go_invoices`
SET
  `usage_location_count` = `location_count`,
  `usage_fee_amount_cents` = `invoiced_amount_cents`;--> statement-breakpoint
ALTER TABLE `store_marketplace_channels` ADD `lifetime_fee_waiver_at` timestamp;--> statement-breakpoint
ALTER TABLE `store_marketplace_channels` ADD `cohort_rank` int;--> statement-breakpoint
ALTER TABLE `store_marketplace_channels` ADD CONSTRAINT `store_marketplace_channels_cohort_rank_unique` UNIQUE(`cohort_rank`);
