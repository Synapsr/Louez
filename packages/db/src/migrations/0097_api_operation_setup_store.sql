ALTER TABLE `api_operations` ADD `setup_store_id` varchar(21);--> statement-breakpoint
CREATE INDEX `api_operations_setup_store_idx` ON `api_operations` (`setup_store_id`);