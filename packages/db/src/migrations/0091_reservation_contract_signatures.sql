CREATE TABLE `reservation_contract_signatures` (
	`id` varchar(21) NOT NULL,
	`reservation_id` varchar(21) NOT NULL,
	`signer_name` varchar(255) NOT NULL,
	`image` longtext NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `reservation_contract_signatures_id` PRIMARY KEY(`id`),
	CONSTRAINT `reservation_contract_signatures_reservation_id_unique` UNIQUE(`reservation_id`)
);
--> statement-breakpoint
ALTER TABLE `reservation_activity` MODIFY COLUMN `activity_type` enum('created','confirmed','rejected','cancelled','picked_up','returned','note_updated','payment_added','payment_updated','payment_received','payment_initiated','payment_failed','payment_expired','deposit_authorized','deposit_captured','deposit_released','deposit_failed','access_link_sent','modified','inspection_departure_started','inspection_departure_completed','inspection_return_started','inspection_return_completed','inspection_damage_detected','inspection_signed','quote_accepted','quote_declined','contract_signed') NOT NULL;--> statement-breakpoint
ALTER TABLE `reservations` ADD `signature_method` varchar(20);--> statement-breakpoint
-- A storefront booking was accepted in the checkout; any other signature so far came from
-- the customer's account.
UPDATE `reservations`
SET `signature_method` = IF(`source` = 'online', 'checkout', 'account')
WHERE `signed_at` IS NOT NULL AND `signature_method` IS NULL;
