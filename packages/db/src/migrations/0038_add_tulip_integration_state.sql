CREATE TABLE `store_tulip_integrations` (
  `id` varchar(21) NOT NULL,
  `integration_id` varchar(21) NOT NULL,
  `renter_uid` varchar(120),
  `archived_renter_uid` varchar(120),
  `public_mode` enum('required','optional','no_public') NOT NULL DEFAULT 'optional',
  `connected_at` timestamp,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `store_tulip_integrations_id` PRIMARY KEY(`id`),
  CONSTRAINT `store_tulip_integrations_integration_unique` UNIQUE(`integration_id`)
);
--> statement-breakpoint
CREATE INDEX `store_tulip_integrations_integration_idx` ON `store_tulip_integrations` (`integration_id`);
--> statement-breakpoint
CREATE INDEX `store_tulip_integrations_renter_uid_idx` ON `store_tulip_integrations` (`renter_uid`);
--> statement-breakpoint
INSERT INTO `store_integrations` (
  `id`,
  `store_id`,
  `provider_key`,
  `category`,
  `enabled`,
  `connected_by_user_id`,
  `provider_account_email`,
  `status`,
  `last_health_check_at`,
  `last_error_code`,
  `last_error_message`
)
SELECT
  LEFT(REPLACE(UUID(), '-', ''), 21),
  `stores`.`id`,
  'tulip',
  'insurance',
  CASE
    WHEN NULLIF(TRIM(JSON_UNQUOTE(JSON_EXTRACT(`stores`.`settings`, '$.integrationData.tulip.renterUid'))), '') IS NOT NULL
      AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(`stores`.`settings`, '$.integrationData.states.tulip.enabled')), 'true') <> 'false'
      THEN true
    ELSE false
  END,
  NULL,
  NULL,
  CASE
    WHEN NULLIF(TRIM(JSON_UNQUOTE(JSON_EXTRACT(`stores`.`settings`, '$.integrationData.tulip.renterUid'))), '') IS NOT NULL
      AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(`stores`.`settings`, '$.integrationData.states.tulip.enabled')), 'true') <> 'false'
      THEN 'active'
    ELSE 'disabled'
  END,
  NULL,
  NULL,
  NULL
FROM `stores`
LEFT JOIN `store_integrations`
  ON `store_integrations`.`store_id` = `stores`.`id`
  AND `store_integrations`.`provider_key` = 'tulip'
WHERE `store_integrations`.`id` IS NULL
  AND JSON_EXTRACT(`stores`.`settings`, '$.integrationData.tulip') IS NOT NULL;
--> statement-breakpoint
INSERT INTO `store_tulip_integrations` (
  `id`,
  `integration_id`,
  `renter_uid`,
  `archived_renter_uid`,
  `public_mode`,
  `connected_at`
)
SELECT
  LEFT(REPLACE(UUID(), '-', ''), 21),
  `store_integrations`.`id`,
  NULLIF(TRIM(JSON_UNQUOTE(JSON_EXTRACT(`stores`.`settings`, '$.integrationData.tulip.renterUid'))), ''),
  NULLIF(TRIM(JSON_UNQUOTE(JSON_EXTRACT(`stores`.`settings`, '$.integrationData.tulip.archivedRenterUid'))), ''),
  CASE JSON_UNQUOTE(JSON_EXTRACT(`stores`.`settings`, '$.integrationData.tulip.publicMode'))
    WHEN 'required' THEN 'required'
    WHEN 'no_public' THEN 'no_public'
    ELSE 'optional'
  END,
  STR_TO_DATE(
    NULLIF(
      SUBSTRING(JSON_UNQUOTE(JSON_EXTRACT(`stores`.`settings`, '$.integrationData.tulip.connectedAt')), 1, 19),
      ''
    ),
    '%Y-%m-%dT%H:%i:%s'
  )
FROM `stores`
INNER JOIN `store_integrations`
  ON `store_integrations`.`store_id` = `stores`.`id`
  AND `store_integrations`.`provider_key` = 'tulip'
WHERE JSON_EXTRACT(`stores`.`settings`, '$.integrationData.tulip') IS NOT NULL
ON DUPLICATE KEY UPDATE
  `renter_uid` = VALUES(`renter_uid`),
  `archived_renter_uid` = VALUES(`archived_renter_uid`),
  `public_mode` = VALUES(`public_mode`),
  `connected_at` = VALUES(`connected_at`),
  `updated_at` = now();
--> statement-breakpoint
UPDATE `stores`
SET `settings` = JSON_REMOVE(
  `settings`,
  '$.integrationData.tulip',
  '$.integrationData.states.tulip'
)
WHERE JSON_EXTRACT(`settings`, '$.integrationData.tulip') IS NOT NULL
  OR JSON_EXTRACT(`settings`, '$.integrationData.states.tulip') IS NOT NULL;
