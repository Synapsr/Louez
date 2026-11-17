ALTER TABLE `stores` ADD `stripe_connect_completed_at` timestamp;--> statement-breakpoint
ALTER TABLE `users` ADD `first_touch_attribution` json;--> statement-breakpoint
-- Stores that can take payments already completed Stripe Connect before the column:
-- marked with their last update, so `stripe_connect_completed` is never counted for them.
UPDATE `stores` SET `stripe_connect_completed_at` = `updated_at` WHERE `stripe_charges_enabled` = 1 AND `stripe_connect_completed_at` IS NULL;
