ALTER TABLE `reservations` ADD `contract_validated_at` timestamp;--> statement-breakpoint
-- Until now the automatic validation on confirmation or payment wrote `signed_at`, which
-- blocked the customer's own signature. Move it to `contract_validated_at` first.
UPDATE `reservations` AS `reservation`
INNER JOIN (
  SELECT DISTINCT `reservation_id`
  FROM `reservation_activity`
  WHERE JSON_UNQUOTE(JSON_EXTRACT(`metadata`, '$.kind')) = 'automatic_contract_validation'
) AS `validated` ON `validated`.`reservation_id` = `reservation`.`id`
SET `reservation`.`contract_validated_at` = `reservation`.`signed_at`
WHERE `reservation`.`signed_at` IS NOT NULL AND `reservation`.`signature_ip` IS NULL
  AND `reservation`.`contract_validated_at` IS NULL;--> statement-breakpoint
-- Then clear the signature it stood for. A storefront booking keeps one at its creation,
-- when the customer accepted the rental terms; any other reservation waits for the customer.
UPDATE `reservations`
SET `signed_at` = IF(`source` = 'online', `created_at`, NULL)
WHERE `contract_validated_at` IS NOT NULL AND `signed_at` = `contract_validated_at`;--> statement-breakpoint
-- A storefront booking not validated yet was accepted at checkout all the same.
UPDATE `reservations`
SET `signed_at` = `created_at`
WHERE `source` = 'online' AND `signed_at` IS NULL;
