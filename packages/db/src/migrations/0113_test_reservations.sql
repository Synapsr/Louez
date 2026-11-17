ALTER TABLE `customers` ADD `is_test` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `reservations` ADD `is_test` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `reservations` ADD `test_store_id` varchar(21) GENERATED ALWAYS AS ((case when `is_test` then `store_id` else null end)) VIRTUAL;--> statement-breakpoint
ALTER TABLE `reservations` ADD CONSTRAINT `reservations_one_test_per_store` UNIQUE(`test_store_id`);