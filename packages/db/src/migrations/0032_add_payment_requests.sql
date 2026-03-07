CREATE TABLE `payment_requests` (
  `id` varchar(21) NOT NULL,
  `store_id` varchar(21) NOT NULL,
  `reservation_id` varchar(21) NOT NULL,
  `token` varchar(64) NOT NULL,
  `amount` decimal(10,2) NOT NULL,
  `currency` varchar(3) NOT NULL DEFAULT 'EUR',
  `description` varchar(255) NOT NULL,
  `type` enum('rental','custom') NOT NULL,
  `status` enum('pending','completed','cancelled') NOT NULL DEFAULT 'pending',
  `expires_at` timestamp NOT NULL,
  `completed_at` timestamp NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `payment_requests_id` PRIMARY KEY(`id`),
  CONSTRAINT `payment_requests_token_unique` UNIQUE(`token`)
);

CREATE INDEX `payment_requests_store_idx` ON `payment_requests` (`store_id`);
CREATE INDEX `payment_requests_reservation_idx` ON `payment_requests` (`reservation_id`);
CREATE INDEX `payment_requests_token_idx` ON `payment_requests` (`token`);
