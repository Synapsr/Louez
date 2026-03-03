SET @sql_add_tulip_opt_in = (
  SELECT IF(
    EXISTS(
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'reservations'
        AND column_name = 'tulip_insurance_opt_in'
    ),
    'SELECT 1',
    'ALTER TABLE `reservations` ADD `tulip_insurance_opt_in` boolean'
  )
);--> statement-breakpoint
PREPARE stmt_add_tulip_opt_in FROM @sql_add_tulip_opt_in;--> statement-breakpoint
EXECUTE stmt_add_tulip_opt_in;--> statement-breakpoint
DEALLOCATE PREPARE stmt_add_tulip_opt_in;--> statement-breakpoint
SET @sql_add_tulip_amount = (
  SELECT IF(
    EXISTS(
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'reservations'
        AND column_name = 'tulip_insurance_amount'
    ),
    'SELECT 1',
    'ALTER TABLE `reservations` ADD `tulip_insurance_amount` decimal(10,2)'
  )
);--> statement-breakpoint
PREPARE stmt_add_tulip_amount FROM @sql_add_tulip_amount;--> statement-breakpoint
EXECUTE stmt_add_tulip_amount;--> statement-breakpoint
DEALLOCATE PREPARE stmt_add_tulip_amount;
