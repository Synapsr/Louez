-- Migration to add new activity types for payment tracking
-- Run this manually if db:push doesn't work properly with MySQL enums

ALTER TABLE `reservation_activity`
MODIFY COLUMN `activity_type` enum(
  'created',
  'confirmed',
  'rejected',
  'cancelled',
  'picked_up',
  'returned',
  'note_updated',
  'payment_added',
  'payment_updated',
  'payment_received',
  'payment_initiated',
  'payment_failed',
  'payment_expired',
  'deposit_authorized',
  'deposit_captured',
  'deposit_released',
  'deposit_failed'
) NOT NULL;
