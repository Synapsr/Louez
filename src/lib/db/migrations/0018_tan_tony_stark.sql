ALTER TABLE `stores` ADD `referral_code` varchar(12);--> statement-breakpoint
ALTER TABLE `stores` ADD `referred_by_user_id` varchar(21);--> statement-breakpoint
ALTER TABLE `stores` ADD `referred_by_store_id` varchar(21);--> statement-breakpoint
ALTER TABLE `stores` ADD CONSTRAINT `stores_referral_code_unique` UNIQUE(`referral_code`);--> statement-breakpoint
CREATE INDEX `stores_referral_code_idx` ON `stores` (`referral_code`);