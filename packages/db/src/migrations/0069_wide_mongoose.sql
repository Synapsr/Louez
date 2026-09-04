ALTER TABLE `customers` ADD `company_number` varchar(64);--> statement-breakpoint
ALTER TABLE `customers` ADD `company_number_scheme` enum('fr_siren','be_bce');--> statement-breakpoint
ALTER TABLE `customers` ADD `vat_number` varchar(64);