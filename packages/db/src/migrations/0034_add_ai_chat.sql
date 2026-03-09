-- Migration: Add AI Chat tables for dashboard AI assistant
-- Stores conversation history per user per store.

CREATE TABLE `ai_chats` (
  `id` varchar(21) NOT NULL,
  `store_id` varchar(21) NOT NULL,
  `user_id` varchar(21) NOT NULL,
  `title` varchar(255),
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`),
  INDEX `ai_chats_store_user_idx` (`store_id`, `user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `ai_chat_messages` (
  `id` varchar(21) NOT NULL,
  `chat_id` varchar(21) NOT NULL,
  `role` enum('user','assistant','system','tool') NOT NULL,
  `content` longtext,
  `tool_invocations` json,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`),
  INDEX `ai_chat_messages_chat_idx` (`chat_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
