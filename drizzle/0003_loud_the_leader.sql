CREATE TABLE `menu_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`branch_id` text NOT NULL,
	`menu_type` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`category` text NOT NULL,
	`price` integer NOT NULL,
	`allergens` text DEFAULT '' NOT NULL,
	`day_label` text DEFAULT '' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`updated_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);--> statement-breakpoint
INSERT INTO `menu_items` (`branch_id`, `menu_type`, `name`, `description`, `category`, `price`, `allergens`, `day_label`, `updated_by`) VALUES
('restaurace-cerna-perla', 'permanent', 'Telecí líčka na červeném víně', 'Bramborové pyré, kořenová zelenina', 'Hlavní jídlo', 295, '1, 7, 9', '', 'vedeni@foodtab.cz'),
('restaurace-cerna-perla', 'permanent', 'Candát na másle', 'Bylinkové brambory, grilovaná zelenina', 'Hlavní jídlo', 319, '4, 7', '', 'vedeni@foodtab.cz'),
('restaurace-cerna-perla', 'weekly', 'Kuřecí supreme', 'Hráškové risotto a parmazán', 'Polední nabídka', 189, '7, 9', 'Pondělí', 'vedeni@foodtab.cz'),
('bernard-bar-tabor', 'permanent', 'Bernardský hovězí guláš', 'Kynutý knedlík a cibule', 'Klasika k pivu', 199, '1, 3, 7', '', 'vedeni@foodtab.cz'),
('bernard-bar-tabor', 'permanent', 'Nakládaný hermelín', 'Cibule, chilli a chléb', 'K pivu', 139, '1, 7', '', 'vedeni@foodtab.cz'),
('bernard-bar-tabor', 'weekly', 'Vepřový řízek', 'Lehký bramborový salát', 'Polední nabídka', 179, '1, 3, 7', 'Pondělí', 'vedeni@foodtab.cz');
