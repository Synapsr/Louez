CREATE TABLE `api_agent_grant_stores` (
	`grant_id` varchar(21) NOT NULL,
	`store_id` varchar(21) NOT NULL,
	CONSTRAINT `api_agent_grant_stores_grant_id_store_id_pk` PRIMARY KEY(`grant_id`,`store_id`)
);
--> statement-breakpoint
CREATE TABLE `api_agent_grants` (
	`id` varchar(21) NOT NULL,
	`user_id` varchar(21) NOT NULL,
	`client_id` varchar(255) NOT NULL,
	`all_stores` boolean NOT NULL DEFAULT false,
	`preset` enum('read','write') NOT NULL,
	`confirm_sensitive` boolean NOT NULL DEFAULT true,
	`bundles` json NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `api_agent_grants_id` PRIMARY KEY(`id`),
	CONSTRAINT `api_agent_grants_user_client_unique` UNIQUE(`user_id`,`client_id`)
);
--> statement-breakpoint
CREATE TABLE `jwks` (
	`id` varchar(21) NOT NULL,
	`public_key` text NOT NULL,
	`private_key` text NOT NULL,
	`alg` varchar(32),
	`crv` varchar(32),
	`created_at` timestamp NOT NULL,
	`expires_at` timestamp,
	CONSTRAINT `jwks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `oauth_access_tokens` (
	`id` varchar(21) NOT NULL,
	`token` varchar(255),
	`client_id` varchar(255) NOT NULL,
	`session_id` varchar(21),
	`user_id` varchar(21),
	`reference_id` varchar(21),
	`authorization_code_id` varchar(255),
	`resources` text,
	`requested_user_info_claims` text,
	`refresh_id` varchar(21),
	`expires_at` timestamp,
	`created_at` timestamp,
	`revoked` timestamp,
	`confirmation` text,
	`scopes` text NOT NULL,
	CONSTRAINT `oauth_access_tokens_id` PRIMARY KEY(`id`),
	CONSTRAINT `oauth_access_tokens_token_unique` UNIQUE(`token`)
);
--> statement-breakpoint
CREATE TABLE `oauth_client_assertions` (
	`id` varchar(64) NOT NULL,
	`expires_at` timestamp NOT NULL,
	CONSTRAINT `oauth_client_assertions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `oauth_client_resources` (
	`id` varchar(21) NOT NULL,
	`client_id` varchar(255) NOT NULL,
	`resource_id` varchar(255) NOT NULL,
	`metadata` text,
	`created_at` timestamp,
	CONSTRAINT `oauth_client_resources_id` PRIMARY KEY(`id`),
	CONSTRAINT `oauth_client_resources_client_resource_unique` UNIQUE(`client_id`,`resource_id`)
);
--> statement-breakpoint
CREATE TABLE `oauth_clients` (
	`id` varchar(21) NOT NULL,
	`client_id` varchar(255) NOT NULL,
	`client_secret` varchar(255),
	`client_discovery_id` varchar(64),
	`disabled` boolean DEFAULT false,
	`skip_consent` boolean,
	`enable_end_session` boolean,
	`subject_type` varchar(32),
	`scopes` text,
	`client_credentials_scopes` text,
	`user_id` varchar(21),
	`created_at` timestamp,
	`updated_at` timestamp,
	`name` varchar(255),
	`uri` text,
	`icon` text,
	`contacts` text,
	`tos` text,
	`policy` text,
	`software_id` varchar(255),
	`software_version` varchar(255),
	`software_statement` text,
	`redirect_uris` text NOT NULL,
	`post_logout_redirect_uris` text,
	`backchannel_logout_uri` text,
	`backchannel_logout_session_required` boolean,
	`token_endpoint_auth_method` varchar(64),
	`application_type` varchar(32),
	`jwks` text,
	`jwks_uri` text,
	`grant_types` text,
	`response_types` text,
	`require_pkce` boolean,
	`dpop_bound_access_tokens` boolean DEFAULT false,
	`reference_id` varchar(255),
	`metadata` text,
	CONSTRAINT `oauth_clients_id` PRIMARY KEY(`id`),
	CONSTRAINT `oauth_clients_client_id_unique` UNIQUE(`client_id`)
);
--> statement-breakpoint
CREATE TABLE `oauth_consents` (
	`id` varchar(21) NOT NULL,
	`client_id` varchar(255) NOT NULL,
	`user_id` varchar(21),
	`reference_id` varchar(21),
	`resources` text,
	`requested_user_info_claims` text,
	`scopes` text NOT NULL,
	`created_at` timestamp,
	`updated_at` timestamp,
	CONSTRAINT `oauth_consents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `oauth_refresh_tokens` (
	`id` varchar(21) NOT NULL,
	`token` varchar(255) NOT NULL,
	`client_id` varchar(255) NOT NULL,
	`session_id` varchar(21),
	`user_id` varchar(21) NOT NULL,
	`reference_id` varchar(21),
	`authorization_code_id` varchar(255),
	`resources` text,
	`requested_user_info_claims` text,
	`expires_at` timestamp,
	`created_at` timestamp,
	`revoked` timestamp,
	`rotated_at` timestamp,
	`rotation_replay_response` text,
	`rotation_replay_expires_at` timestamp,
	`auth_time` timestamp,
	`confirmation` text,
	`scopes` text NOT NULL,
	CONSTRAINT `oauth_refresh_tokens_id` PRIMARY KEY(`id`),
	CONSTRAINT `oauth_refresh_tokens_token_unique` UNIQUE(`token`)
);
--> statement-breakpoint
CREATE TABLE `oauth_resources` (
	`id` varchar(21) NOT NULL,
	`identifier` varchar(255) NOT NULL,
	`name` varchar(255) NOT NULL,
	`access_token_ttl` int,
	`refresh_token_ttl` int,
	`signing_algorithm` varchar(32),
	`signing_key_id` varchar(64),
	`allowed_scopes` text,
	`custom_claims` text,
	`dpop_bound_access_tokens_required` boolean DEFAULT false,
	`disabled` boolean DEFAULT false,
	`created_at` timestamp,
	`updated_at` timestamp,
	`policy_version` int DEFAULT 1,
	`metadata` text,
	CONSTRAINT `oauth_resources_id` PRIMARY KEY(`id`),
	CONSTRAINT `oauth_resources_identifier_unique` UNIQUE(`identifier`)
);
--> statement-breakpoint
ALTER TABLE `api_agent_grant_stores` ADD CONSTRAINT `api_agent_grant_stores_grant_id_api_agent_grants_id_fk` FOREIGN KEY (`grant_id`) REFERENCES `api_agent_grants`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `api_agent_grant_stores` ADD CONSTRAINT `api_agent_grant_stores_store_id_stores_id_fk` FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `api_agent_grants` ADD CONSTRAINT `api_agent_grants_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `api_agent_grants` ADD CONSTRAINT `api_agent_grants_client_id_oauth_clients_client_id_fk` FOREIGN KEY (`client_id`) REFERENCES `oauth_clients`(`client_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `oauth_access_tokens` ADD CONSTRAINT `oauth_access_tokens_client_id_oauth_clients_client_id_fk` FOREIGN KEY (`client_id`) REFERENCES `oauth_clients`(`client_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `oauth_access_tokens` ADD CONSTRAINT `oauth_access_tokens_session_id_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `oauth_access_tokens` ADD CONSTRAINT `oauth_access_tokens_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `oauth_access_tokens` ADD CONSTRAINT `oauth_access_tokens_reference_id_api_agent_grants_id_fk` FOREIGN KEY (`reference_id`) REFERENCES `api_agent_grants`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `oauth_access_tokens` ADD CONSTRAINT `oauth_access_tokens_refresh_id_oauth_refresh_tokens_id_fk` FOREIGN KEY (`refresh_id`) REFERENCES `oauth_refresh_tokens`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `oauth_client_resources` ADD CONSTRAINT `oauth_client_resources_client_id_oauth_clients_client_id_fk` FOREIGN KEY (`client_id`) REFERENCES `oauth_clients`(`client_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `oauth_client_resources` ADD CONSTRAINT `oauth_client_resources_resource_id_oauth_resources_identifier_fk` FOREIGN KEY (`resource_id`) REFERENCES `oauth_resources`(`identifier`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `oauth_clients` ADD CONSTRAINT `oauth_clients_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `oauth_consents` ADD CONSTRAINT `oauth_consents_client_id_oauth_clients_client_id_fk` FOREIGN KEY (`client_id`) REFERENCES `oauth_clients`(`client_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `oauth_consents` ADD CONSTRAINT `oauth_consents_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `oauth_consents` ADD CONSTRAINT `oauth_consents_reference_id_api_agent_grants_id_fk` FOREIGN KEY (`reference_id`) REFERENCES `api_agent_grants`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `oauth_refresh_tokens` ADD CONSTRAINT `oauth_refresh_tokens_client_id_oauth_clients_client_id_fk` FOREIGN KEY (`client_id`) REFERENCES `oauth_clients`(`client_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `oauth_refresh_tokens` ADD CONSTRAINT `oauth_refresh_tokens_session_id_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `oauth_refresh_tokens` ADD CONSTRAINT `oauth_refresh_tokens_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `oauth_refresh_tokens` ADD CONSTRAINT `oauth_refresh_tokens_reference_id_api_agent_grants_id_fk` FOREIGN KEY (`reference_id`) REFERENCES `api_agent_grants`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `api_agent_grant_stores_store_idx` ON `api_agent_grant_stores` (`store_id`);--> statement-breakpoint
CREATE INDEX `oauth_access_tokens_client_id_idx` ON `oauth_access_tokens` (`client_id`);--> statement-breakpoint
CREATE INDEX `oauth_access_tokens_session_id_idx` ON `oauth_access_tokens` (`session_id`);--> statement-breakpoint
CREATE INDEX `oauth_access_tokens_user_id_idx` ON `oauth_access_tokens` (`user_id`);--> statement-breakpoint
CREATE INDEX `oauth_access_tokens_authorization_code_id_idx` ON `oauth_access_tokens` (`authorization_code_id`);--> statement-breakpoint
CREATE INDEX `oauth_access_tokens_refresh_id_idx` ON `oauth_access_tokens` (`refresh_id`);--> statement-breakpoint
CREATE INDEX `oauth_client_resources_resource_id_idx` ON `oauth_client_resources` (`resource_id`);--> statement-breakpoint
CREATE INDEX `oauth_clients_user_id_idx` ON `oauth_clients` (`user_id`);--> statement-breakpoint
CREATE INDEX `oauth_consents_client_id_idx` ON `oauth_consents` (`client_id`);--> statement-breakpoint
CREATE INDEX `oauth_consents_user_id_idx` ON `oauth_consents` (`user_id`);--> statement-breakpoint
CREATE INDEX `oauth_refresh_tokens_client_id_idx` ON `oauth_refresh_tokens` (`client_id`);--> statement-breakpoint
CREATE INDEX `oauth_refresh_tokens_session_id_idx` ON `oauth_refresh_tokens` (`session_id`);--> statement-breakpoint
CREATE INDEX `oauth_refresh_tokens_user_id_idx` ON `oauth_refresh_tokens` (`user_id`);--> statement-breakpoint
CREATE INDEX `oauth_refresh_tokens_authorization_code_id_idx` ON `oauth_refresh_tokens` (`authorization_code_id`);