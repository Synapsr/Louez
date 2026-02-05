ALTER TABLE `customers` ADD `customer_type` enum('individual','business') DEFAULT 'individual' NOT NULL;--> statement-breakpoint
ALTER TABLE `customers` ADD `company_name` varchar(255);