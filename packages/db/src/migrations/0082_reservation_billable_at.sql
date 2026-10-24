-- One statement: MySQL applies all of it or none of it, and migrate.ts never
-- sees a half-applied file. Explicit NULL: with explicit_defaults_for_timestamp
-- off, a bare timestamp column becomes NOT NULL with a zero-date default.
ALTER TABLE `reservations`
  ADD `billable_at` timestamp NULL,
  ADD `withdrawn_at` timestamp NULL,
  ADD INDEX `reservations_billable_at_idx` (`billable_at`);
