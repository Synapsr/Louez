ALTER TABLE `api_handoffs` ADD `consumed_at` timestamp(3);--> statement-breakpoint
ALTER TABLE `api_handoffs` ADD `consumed_operation_id` varchar(21);--> statement-breakpoint
ALTER TABLE `api_operations` ADD `approval_id` varchar(21);--> statement-breakpoint
CREATE INDEX `api_operations_approval_idx` ON `api_operations` (`approval_id`);