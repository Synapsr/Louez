-- 'quote' and 'declined' joined the schema without a migration, so a database
-- built from migrations alone (a fresh self-host install, CI) could not store
-- them. Align the column with the schema: all eight statuses, NOT NULL, default
-- 'pending'. On such a database this only appends two values. A database that
-- already has them only gets NOT NULL back. A NULL status cannot happen through
-- the app; set it to 'pending' first so this file can never fail at boot.
UPDATE `reservations` SET `reservation_status` = 'pending' WHERE `reservation_status` IS NULL;--> statement-breakpoint
ALTER TABLE `reservations` MODIFY COLUMN `reservation_status` enum('pending','confirmed','ongoing','completed','cancelled','rejected','quote','declined') NOT NULL DEFAULT 'pending';
