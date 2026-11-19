CREATE TABLE `store_ai_crawls` (
	`id` varchar(21) NOT NULL,
	`store_id` varchar(21) NOT NULL,
	`day` date NOT NULL,
	`crawler` varchar(32) NOT NULL,
	`resource` enum('page','llms_txt') NOT NULL,
	`hits` int NOT NULL DEFAULT 0,
	CONSTRAINT `store_ai_crawls_id` PRIMARY KEY(`id`),
	CONSTRAINT `store_ai_crawls_store_day_crawler_resource_unique` UNIQUE(`store_id`,`day`,`crawler`,`resource`)
);
--> statement-breakpoint
ALTER TABLE `page_views` ADD `ai_assistant` varchar(20);