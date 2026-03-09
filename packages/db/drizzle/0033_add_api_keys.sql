-- Migration: Add API Keys table for MCP Server & REST API authentication
-- This table stores hashed API keys with granular permissions per store.

CREATE TABLE `api_keys` (
  `id` varchar(21) NOT NULL,
  `store_id` varchar(21) NOT NULL,
  `user_id` varchar(21) NOT NULL,
  `name` varchar(100) NOT NULL,
  `key_prefix` varchar(12) NOT NULL,
  `key_hash` varchar(64) NOT NULL,
  `permissions` json NOT NULL,
  `last_used_at` timestamp NULL DEFAULT NULL,
  `expires_at` timestamp NULL DEFAULT NULL,
  `revoked_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`),
  INDEX `api_keys_store_idx` (`store_id`),
  UNIQUE KEY `api_keys_key_hash_unique` (`key_hash`),
  INDEX `api_keys_prefix_idx` (`key_prefix`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
