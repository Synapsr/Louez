ALTER TABLE `api_handoffs` MODIFY COLUMN `status` enum('pending','opened','completed','failed','approved') NOT NULL DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE `api_handoffs` MODIFY COLUMN `token_hash` varchar(64);--> statement-breakpoint
ALTER TABLE `api_handoffs` ADD `procedure` varchar(128);--> statement-breakpoint
ALTER TABLE `api_handoffs` ADD `binding_hash` varchar(64);