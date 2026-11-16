ALTER TABLE `reservation_items` ADD `tax_exempt` boolean;--> statement-breakpoint
ALTER TABLE `reservations` ADD `tax_display_mode` enum('inclusive','exclusive');