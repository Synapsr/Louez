ALTER TABLE `subscriptions` ADD `pricing_version` varchar(32);--> statement-breakpoint
UPDATE `subscriptions`
SET `pricing_version` = 'payg-ladder-v1'
WHERE `pricing_version` IS NULL AND `pay_as_you_go_config` IS NOT NULL;
