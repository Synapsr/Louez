-- A reservation's total never contains its deposit. Until commit 954a509f the
-- storefront checkout wrote some totals with the deposit in them; this takes
-- it out of exactly those rows, so every reader can read the total as it is.
--
-- A row is changed only when its total is its parts plus the deposit, to the
-- cent (subtotal, less the discount, plus the delivery fee, plus the deposit),
-- and its total cannot also be read without the deposit (its parts plus its
-- tax, or plus its insurance): such an ambiguous row is left as it is. Only
-- online rows created before 2026-04-01 (UTC) that no writer has priced since
-- (no recorded display mode) are considered. Once changed, a row no longer
-- matches: a second run changes nothing. `updated_at` is left as it is; the
-- history line written first records the total before and the deposit taken
-- out. A row whose total would fall below zero is left as it is.
--
-- Interrupted and run again, it says the truth: both statements run in one
-- transaction on the runner's one connection, and the history line is
-- written only for a row that holds none of this migration's yet, so each
-- changed row ends with exactly one line and one decrement. Each statement
-- reads the reservations table once, at start-up.
START TRANSACTION;--> statement-breakpoint
INSERT INTO `reservation_activity` (
	`id`,
	`reservation_id`,
	`user_id`,
	`activity_type`,
	`description`,
	`metadata`,
	`created_at`
)
SELECT
	LEFT(REPLACE(UUID(), '-', ''), 21),
	`id`,
	NULL,
	'modified',
	NULL,
	JSON_OBJECT(
		'kind', 'deposit_removed_from_total',
		'migration', '0108',
		'previousTotal', CAST(`total_amount` AS CHAR),
		'depositRemoved', CAST(`deposit_amount` AS CHAR),
		'total', CAST(`total_amount` - `deposit_amount` AS CHAR)
	),
	NOW()
FROM `reservations`
WHERE NOT EXISTS (
		SELECT 1 FROM `reservation_activity`
		WHERE `reservation_activity`.`reservation_id` = `reservations`.`id`
			AND `reservation_activity`.`activity_type` = 'modified'
			AND JSON_UNQUOTE(JSON_EXTRACT(`reservation_activity`.`metadata`, '$.migration')) = '0108'
	)
	AND `deposit_amount` > 0
	AND `source` = 'online'
	AND UNIX_TIMESTAMP(`created_at`) < 1775001600
	AND `tax_display_mode` IS NULL
	AND `total_amount` = `subtotal_amount` - COALESCE(`discount_amount`, 0) + COALESCE(`delivery_fee`, 0) + `deposit_amount`
	AND `total_amount` <> `subtotal_amount` - COALESCE(`discount_amount`, 0) + COALESCE(`delivery_fee`, 0) + COALESCE(`tax_amount`, 0)
	AND `total_amount` <> `subtotal_amount` - COALESCE(`discount_amount`, 0) + COALESCE(`delivery_fee`, 0) + COALESCE(`tulip_insurance_amount`, 0)
	AND `total_amount` - `deposit_amount` >= 0;--> statement-breakpoint
UPDATE `reservations`
SET `total_amount` = `total_amount` - `deposit_amount`
WHERE `deposit_amount` > 0
	AND `source` = 'online'
	AND UNIX_TIMESTAMP(`created_at`) < 1775001600
	AND `tax_display_mode` IS NULL
	AND `total_amount` = `subtotal_amount` - COALESCE(`discount_amount`, 0) + COALESCE(`delivery_fee`, 0) + `deposit_amount`
	AND `total_amount` <> `subtotal_amount` - COALESCE(`discount_amount`, 0) + COALESCE(`delivery_fee`, 0) + COALESCE(`tax_amount`, 0)
	AND `total_amount` <> `subtotal_amount` - COALESCE(`discount_amount`, 0) + COALESCE(`delivery_fee`, 0) + COALESCE(`tulip_insurance_amount`, 0)
	AND `total_amount` - `deposit_amount` >= 0;--> statement-breakpoint
COMMIT;
