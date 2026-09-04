ALTER TABLE `stores` ADD `signup_origin` varchar(32);--> statement-breakpoint
ALTER TABLE `users` ADD `signup_origin` varchar(32);--> statement-breakpoint
ALTER TABLE `users` ADD `reeent_intro_acknowledged_at` timestamp;