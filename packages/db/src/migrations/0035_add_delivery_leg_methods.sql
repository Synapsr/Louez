-- Migration: Add outbound_method and return_method columns to reservations
-- Part of the delivery leg-based refactor: each leg (outbound/return) can independently
-- be 'store' (pickup/return at store) or 'address' (delivery/collection at customer address).
-- Existing reservations default to 'store' for both legs.
-- The legacy delivery_option column is kept for backward compatibility.

ALTER TABLE `reservations` ADD `outbound_method` varchar(20) NOT NULL DEFAULT 'store';--> statement-breakpoint
ALTER TABLE `reservations` ADD `return_method` varchar(20) NOT NULL DEFAULT 'store';--> statement-breakpoint

-- Backfill existing data:
-- 1. Reservations with delivery_option='delivery' had outbound delivery
UPDATE `reservations` SET `outbound_method` = 'address' WHERE `delivery_option` = 'delivery';--> statement-breakpoint
-- 2. Reservations that already have a return_address (from migration 0030) also had return delivery
UPDATE `reservations` SET `return_method` = 'address' WHERE `return_address` IS NOT NULL AND `return_address` != '';
