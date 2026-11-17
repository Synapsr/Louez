ALTER TABLE `stores` ADD `stripe_connect_completed_at` timestamp;--> statement-breakpoint
ALTER TABLE `users` ADD `first_touch_attribution` json;--> statement-breakpoint
-- Stores that completed Stripe Connect before the column: chargeable now, or that took a
-- Stripe payment before (an account disabled since). Marked with their last update, so
-- `stripe_connect_completed` is never counted for them.
UPDATE `stores` SET `stripe_connect_completed_at` = `updated_at`
WHERE `stripe_connect_completed_at` IS NULL
  AND (
    `stripe_charges_enabled` = 1
    OR EXISTS (
      SELECT 1 FROM `payments` p
      JOIN `reservations` r ON r.`id` = p.`reservation_id`
      WHERE r.`store_id` = `stores`.`id` AND p.`stripe_payment_intent_id` IS NOT NULL
    )
  );
