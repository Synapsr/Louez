ALTER TABLE `documents` ADD `cgv_snapshot` longtext;--> statement-breakpoint
ALTER TABLE `stores` ADD `include_cgv_in_contract` boolean DEFAULT false NOT NULL;