-- ============================================================
-- Migration: NextAuth v5 → Better Auth
-- WARNING: This invalidates all active sessions.
-- ============================================================

-- 1. verification_tokens → verification (rename + restructure)
RENAME TABLE `verification_tokens` TO `verification`;--> statement-breakpoint
ALTER TABLE `verification` RENAME COLUMN `token` TO `value`;--> statement-breakpoint
ALTER TABLE `verification` RENAME COLUMN `expires` TO `expires_at`;--> statement-breakpoint
ALTER TABLE `verification` DROP INDEX `verification_tokens_identifier_token`;--> statement-breakpoint
DELETE FROM `verification`;--> statement-breakpoint
ALTER TABLE `verification` ADD `id` varchar(21) NOT NULL;--> statement-breakpoint
ALTER TABLE `verification` ADD `created_at` timestamp DEFAULT (now());--> statement-breakpoint
ALTER TABLE `verification` ADD `updated_at` timestamp DEFAULT (now());--> statement-breakpoint
ALTER TABLE `verification` ADD PRIMARY KEY(`id`);--> statement-breakpoint

-- 2. users: emailVerified timestamp → boolean (temp column to avoid overflow)
ALTER TABLE `users` ADD COLUMN `email_verified_new` boolean NOT NULL DEFAULT false;--> statement-breakpoint
UPDATE `users` SET `email_verified_new` = TRUE WHERE `email_verified` IS NOT NULL;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `email_verified`;--> statement-breakpoint
ALTER TABLE `users` CHANGE COLUMN `email_verified_new` `email_verified` boolean NOT NULL DEFAULT false;--> statement-breakpoint

-- 3. accounts: add new columns, migrate data, drop legacy columns
ALTER TABLE `accounts` ADD `access_token_expires_at` timestamp;--> statement-breakpoint
ALTER TABLE `accounts` ADD `refresh_token_expires_at` timestamp;--> statement-breakpoint
ALTER TABLE `accounts` ADD `password` text;--> statement-breakpoint
ALTER TABLE `accounts` ADD `created_at` timestamp DEFAULT (now()) NOT NULL;--> statement-breakpoint
ALTER TABLE `accounts` ADD `updated_at` timestamp DEFAULT (now()) NOT NULL;--> statement-breakpoint
UPDATE `accounts` SET `access_token_expires_at` = FROM_UNIXTIME(`expires_at`) WHERE `expires_at` IS NOT NULL;--> statement-breakpoint
ALTER TABLE `accounts` DROP COLUMN `type`;--> statement-breakpoint
ALTER TABLE `accounts` DROP COLUMN `expires_at`;--> statement-breakpoint
ALTER TABLE `accounts` DROP COLUMN `token_type`;--> statement-breakpoint
ALTER TABLE `accounts` DROP COLUMN `session_state`;--> statement-breakpoint

-- 4. sessions: truncate (invalidate all) + restructure
ALTER TABLE `sessions` DROP PRIMARY KEY;--> statement-breakpoint
DELETE FROM `sessions`;--> statement-breakpoint
ALTER TABLE `sessions` ADD `id` varchar(21) NOT NULL;--> statement-breakpoint
ALTER TABLE `sessions` ADD `token` varchar(255) NOT NULL;--> statement-breakpoint
ALTER TABLE `sessions` ADD `expires_at` timestamp NOT NULL;--> statement-breakpoint
ALTER TABLE `sessions` ADD `ip_address` varchar(255);--> statement-breakpoint
ALTER TABLE `sessions` ADD `user_agent` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `created_at` timestamp DEFAULT (now()) NOT NULL;--> statement-breakpoint
ALTER TABLE `sessions` ADD `updated_at` timestamp DEFAULT (now()) NOT NULL;--> statement-breakpoint
ALTER TABLE `sessions` DROP COLUMN `session_token`;--> statement-breakpoint
ALTER TABLE `sessions` DROP COLUMN `expires`;--> statement-breakpoint
ALTER TABLE `sessions` ADD PRIMARY KEY(`id`);--> statement-breakpoint
ALTER TABLE `sessions` ADD CONSTRAINT `sessions_token_unique` UNIQUE(`token`);--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `sessions_token_idx` ON `sessions` (`token`);
