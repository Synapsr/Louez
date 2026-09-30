CREATE TABLE `auth_rate_limits` (
	`id` varchar(21) NOT NULL,
	`key` varchar(255) NOT NULL,
	`count` int NOT NULL,
	`last_request` bigint NOT NULL,
	CONSTRAINT `auth_rate_limits_id` PRIMARY KEY(`id`),
	CONSTRAINT `auth_rate_limits_key_unique` UNIQUE(`key`)
);
