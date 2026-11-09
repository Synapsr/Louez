ALTER TABLE `api_handoffs` DROP INDEX `api_handoffs_active_unique`;--> statement-breakpoint
ALTER TABLE `api_handoffs` ADD `subject` varchar(64) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `api_handoffs` ADD `payload` json;--> statement-breakpoint
ALTER TABLE `api_handoffs` ADD CONSTRAINT `api_handoffs_active_unique` UNIQUE(`store_id`,`kind`,`subject`,`active_slot`);