CREATE TABLE `google_ads_conversions` (
	`user_id` varchar(21) NOT NULL,
	`click_id_type` enum('gclid','gbraid','wbraid') NOT NULL,
	`click_id` varchar(255) NOT NULL,
	`clicked_at` timestamp(3) NOT NULL,
	`converted_at` timestamp(3) NOT NULL,
	`ad_user_data_consent` enum('granted','denied') NOT NULL,
	`ad_personalization_consent` enum('granted','denied') NOT NULL,
	`status` enum('pending','sending','sent','failed','expired','abandoned') NOT NULL DEFAULT 'pending',
	`attempts` int NOT NULL DEFAULT 0,
	`next_attempt_at` timestamp(3) NOT NULL,
	`locked_until` timestamp(3),
	`request_id` varchar(255),
	`last_error` text,
	`sent_at` timestamp(3),
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `google_ads_conversions_user_id` PRIMARY KEY(`user_id`)
);
--> statement-breakpoint
ALTER TABLE `google_ads_conversions` ADD CONSTRAINT `google_ads_conversions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `google_ads_conversions_due_idx` ON `google_ads_conversions` (`status`,`next_attempt_at`);