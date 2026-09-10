ALTER TABLE `reservations` ADD `billing_snapshot` json;--> statement-breakpoint
UPDATE `reservations` `r`
INNER JOIN `customers` `c` ON `c`.`id` = `r`.`customer_id`
SET `r`.`billing_snapshot` = JSON_OBJECT(
	'customerType', `c`.`customer_type`,
	'companyName', IF(`c`.`customer_type` = 'business', `c`.`company_name`, NULL),
	'companyNumber', IF(`c`.`customer_type` = 'business', `c`.`company_number`, NULL),
	'companyNumberScheme', IF(`c`.`customer_type` = 'business', `c`.`company_number_scheme`, NULL),
	'vatNumber', IF(`c`.`customer_type` = 'business', `c`.`vat_number`, NULL)
)
WHERE `r`.`billing_snapshot` IS NULL;
