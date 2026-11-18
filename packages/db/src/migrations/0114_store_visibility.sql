CREATE TABLE `store_visibility_steps` (
	`id` varchar(21) NOT NULL,
	`store_id` varchar(21) NOT NULL,
	`step` varchar(40) NOT NULL,
	`status` enum('done','skipped') NOT NULL,
	`user_id` varchar(21),
	`decided_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `store_visibility_steps_id` PRIMARY KEY(`id`),
	CONSTRAINT `store_visibility_steps_store_step_unique` UNIQUE(`store_id`,`step`)
);
--> statement-breakpoint
ALTER TABLE `page_views` ADD `source` varchar(20);