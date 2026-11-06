ALTER TABLE `customers` MODIFY COLUMN `email` varchar(255);--> statement-breakpoint
CREATE INDEX `customers_store_phone_idx` ON `customers` (`store_id`,`phone`);