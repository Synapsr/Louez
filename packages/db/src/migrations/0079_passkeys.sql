CREATE TABLE `passkey` (
	`id` varchar(21) NOT NULL,
	`name` varchar(100),
	`public_key` text NOT NULL,
	`user_id` varchar(21) NOT NULL,
	`credential_id` varchar(2048) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`counter` bigint unsigned NOT NULL,
	`device_type` varchar(32) NOT NULL,
	`backed_up` boolean NOT NULL,
	`transports` varchar(255),
	`aaguid` varchar(36),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `passkey_id` PRIMARY KEY(`id`),
	CONSTRAINT `passkey_credential_id_unique` UNIQUE(`credential_id`)
);
--> statement-breakpoint
ALTER TABLE `verification` MODIFY COLUMN `value` text NOT NULL;--> statement-breakpoint
ALTER TABLE `passkey` ADD CONSTRAINT `passkey_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `passkey_user_id_idx` ON `passkey` (`user_id`);