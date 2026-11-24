ALTER TABLE `reservation_monday_items`
  ADD COLUMN `checklist_subitem_id` varchar(64);
--> statement-breakpoint
ALTER TABLE `reservation_monday_items`
  ADD COLUMN `checklist_subitem_board_id` varchar(64);
--> statement-breakpoint
ALTER TABLE `reservation_monday_items`
  ADD COLUMN `checklist_hash` varchar(64);
