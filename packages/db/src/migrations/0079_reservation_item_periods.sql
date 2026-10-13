ALTER TABLE `reservation_items`
	ADD COLUMN `start_date` timestamp NULL,
	ADD COLUMN `end_date` timestamp NULL;

UPDATE `reservation_items` AS `item`
INNER JOIN `reservations` AS `reservation`
	ON `reservation`.`id` = `item`.`reservation_id`
SET
	`item`.`start_date` = `reservation`.`start_date`,
	`item`.`end_date` = `reservation`.`end_date`
WHERE `item`.`start_date` IS NULL OR `item`.`end_date` IS NULL;
