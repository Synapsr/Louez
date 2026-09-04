CREATE TABLE `account_departure_reason_counters` (
	`account_departure_reason` enum('too_expensive','missing_features','difficult_to_use','no_longer_needed','switched_service','technical_issues','privacy_concerns','other') NOT NULL,
	`count` int unsigned NOT NULL DEFAULT 0,
	CONSTRAINT `account_departure_reason_counters_account_departure_reason` PRIMARY KEY(`account_departure_reason`)
);
