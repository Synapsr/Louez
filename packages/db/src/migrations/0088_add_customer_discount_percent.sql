ALTER TABLE `customers` ADD `discount_percent` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `reservations` ADD `production_start_date` timestamp NULL;--> statement-breakpoint
ALTER TABLE `reservations` ADD `production_end_date` timestamp NULL;
