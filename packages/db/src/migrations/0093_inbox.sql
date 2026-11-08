CREATE TABLE `inbox_acknowledgements` (
	`id` varchar(21) NOT NULL,
	`store_id` varchar(21) NOT NULL,
	`item_type` varchar(40) NOT NULL,
	`record_id` varchar(64) NOT NULL,
	`occurred_at` timestamp(3) NOT NULL,
	`user_id` varchar(21) NOT NULL,
	`credential_id` varchar(64),
	`client_name` varchar(100),
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `inbox_acknowledgements_id` PRIMARY KEY(`id`),
	CONSTRAINT `inbox_acknowledgements_occurrence_unique` UNIQUE(`store_id`,`item_type`,`record_id`,`occurred_at`)
);
--> statement-breakpoint
CREATE INDEX `reservations_store_status_end_idx` ON `reservations` (`store_id`,`reservation_status`,`end_date`);