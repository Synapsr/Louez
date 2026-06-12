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
