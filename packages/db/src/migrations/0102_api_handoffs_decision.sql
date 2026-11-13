ALTER TABLE `api_handoffs` ADD `decision` enum('approved','refused');--> statement-breakpoint
ALTER TABLE `api_handoffs` ADD `decided_at` timestamp(3);--> statement-breakpoint
ALTER TABLE `api_handoffs` ADD `decided_by_user_id` varchar(21);--> statement-breakpoint
ALTER TABLE `api_handoffs` ADD `decision_reason` varchar(500);