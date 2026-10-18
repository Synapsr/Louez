CREATE TABLE `voice_session` (
	`conversation_id` varchar(21) NOT NULL,
	`store_id` varchar(21) NOT NULL,
	`provider_call_id` varchar(64) NOT NULL,
	`stream_id` varchar(128),
	`connection_id` varchar(36),
	`openai_session_id` varchar(128),
	`status` enum('pending','active','end','transfer','failed') NOT NULL DEFAULT 'pending',
	`live_model` varchar(80) NOT NULL,
	`backend_model` varchar(80) NOT NULL,
	`voice` varchar(40) NOT NULL,
	`backend_usage` json,
	`audio_seconds` int NOT NULL DEFAULT 0,
	`usage_finalized` boolean NOT NULL DEFAULT false,
	`settled` boolean NOT NULL DEFAULT false,
	`tool_count` int NOT NULL DEFAULT 0,
	`max_seconds` int NOT NULL,
	`pstn_ended_at` timestamp,
	`started_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `voice_session_conversation_id` PRIMARY KEY(`conversation_id`),
	CONSTRAINT `voice_sessions_call_unique` UNIQUE(`provider_call_id`)
);
--> statement-breakpoint
CREATE TABLE `voice_tool_execution` (
	`id` varchar(64) NOT NULL,
	`conversation_id` varchar(21) NOT NULL,
	`input_hash` varchar(64) NOT NULL,
	`name` varchar(80) NOT NULL,
	`status` enum('started','completed') NOT NULL DEFAULT 'started',
	`output` json,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `voice_tool_execution_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `voice_sessions_unsettled_idx` ON `voice_session` (`settled`,`created_at`);--> statement-breakpoint
CREATE INDEX `voice_sessions_store_status_idx` ON `voice_session` (`store_id`,`status`);--> statement-breakpoint
CREATE INDEX `voice_tool_executions_conversation_idx` ON `voice_tool_execution` (`conversation_id`);