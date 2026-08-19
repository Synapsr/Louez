ALTER TABLE `store_marketplace_channels` ADD `owner_decided_at` timestamp;--> statement-breakpoint
ALTER TABLE `store_marketplace_channels` ADD `consent_basis` enum('explicit','terms_update') DEFAULT 'explicit' NOT NULL;--> statement-breakpoint
-- Before publication-by-default, every channel row could only be created by an
-- owner action. Backfill those rows so the gated job never reinterprets them as undecided.
UPDATE `store_marketplace_channels`
SET `owner_decided_at` = COALESCE(`disabled_at`, `terms_accepted_at`, `published_at`, `created_at`)
WHERE `owner_decided_at` IS NULL;
