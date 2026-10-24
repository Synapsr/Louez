-- Backfill reservations.billable_at and withdrawn_at. Data only, in its own file,
-- so migrate.ts never marks it applied without running it. Each statement fills
-- NULLs only, so a second run changes nothing. Rerun it with
-- `pnpm --filter @louez/db reservations:backfill-billable-at --apply`.
--
-- Both statements run in UTC (SET_VAR). In a session time zone with DST, MySQL
-- copies a TIMESTAMP through local time, and an instant in the hour repeated in
-- autumn comes back an hour later.
--
-- billable_at: reservations in a billable status, plus cancelled ones with
-- evidence that they were billable. The first billable-entry activity, else the
-- earliest pay-as-you-go fee row, else created_at (AI and MCP confirmations
-- left no other trace).
UPDATE /*+ SET_VAR(time_zone = '+00:00') */ `reservations` `r`
SET `r`.`billable_at` = COALESCE(
  (SELECT MIN(`a`.`created_at`) FROM `reservation_activity` `a`
    WHERE `a`.`reservation_id` = `r`.`id`
      AND (`a`.`activity_type` IN ('confirmed', 'quote_accepted', 'picked_up', 'returned')
        OR (`a`.`activity_type` = 'created'
          AND JSON_UNQUOTE(JSON_EXTRACT(`a`.`metadata`, '$.status')) = 'confirmed'))),
  (SELECT MIN(`f`.`created_at`) FROM `platform_fee` `f`
    WHERE `f`.`reservation_id` = `r`.`id`
      AND `f`.`platform_fee_source` IN ('online', 'manual', 'free')),
  `r`.`created_at`)
WHERE `r`.`billable_at` IS NULL
  AND (`r`.`reservation_status` IN ('confirmed', 'ongoing', 'completed')
    OR (`r`.`reservation_status` = 'cancelled' AND EXISTS (
      SELECT 1 FROM `reservation_activity` `e`
      WHERE `e`.`reservation_id` = `r`.`id`
        AND (`e`.`activity_type` IN ('confirmed', 'quote_accepted', 'picked_up', 'returned')
          OR (`e`.`activity_type` = 'created'
            AND JSON_UNQUOTE(JSON_EXTRACT(`e`.`metadata`, '$.status')) = 'confirmed')
          OR (`e`.`activity_type` = 'cancelled'
            AND JSON_UNQUOTE(JSON_EXTRACT(`e`.`metadata`, '$.previousStatus')) IN ('confirmed', 'ongoing'))))));
--> statement-breakpoint
-- withdrawn_at: cancelled reservations that were billable (rejected and declined
-- only come from pending or quote). The first cancellation activity after
-- billable_at, else the time the fee was voided, else updated_at.
UPDATE /*+ SET_VAR(time_zone = '+00:00') */ `reservations` `r`
SET `r`.`withdrawn_at` = COALESCE(
  (SELECT MIN(`a`.`created_at`) FROM `reservation_activity` `a`
    WHERE `a`.`reservation_id` = `r`.`id` AND `a`.`activity_type` = 'cancelled'
      AND `a`.`created_at` >= `r`.`billable_at`),
  (SELECT MAX(`f`.`updated_at`) FROM `platform_fee` `f`
    WHERE `f`.`reservation_id` = `r`.`id` AND `f`.`platform_fee_status` = 'voided'
      AND `f`.`updated_at` >= `r`.`billable_at`),
  GREATEST(`r`.`updated_at`, `r`.`billable_at`))
WHERE `r`.`withdrawn_at` IS NULL
  AND `r`.`billable_at` IS NOT NULL
  AND `r`.`reservation_status` = 'cancelled';
