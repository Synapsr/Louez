ALTER TABLE `stores` ADD `demo_vertical` varchar(32);--> statement-breakpoint
ALTER TABLE `stores` ADD `demo_expires_at` timestamp;--> statement-breakpoint
CREATE INDEX `stores_demo_expires_idx` ON `stores` (`demo_expires_at`);