CREATE TABLE `assigned_tasks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_by_email` text NOT NULL,
	`created_by_name` text NOT NULL,
	`origin_location` text NOT NULL,
	`audience_type` text DEFAULT 'company' NOT NULL,
	`target_branch_id` text,
	`target_person_email` text,
	`target_person_name` text,
	`due_at` text NOT NULL,
	`priority` text DEFAULT 'normal' NOT NULL,
	`completed` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `recipes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`branch_id` text NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`portions` integer DEFAULT 1 NOT NULL,
	`allergens` text DEFAULT '' NOT NULL,
	`ingredients` text NOT NULL,
	`instructions` text NOT NULL,
	`updated_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE `announcements` ADD `audience_type` text DEFAULT 'company' NOT NULL;--> statement-breakpoint
ALTER TABLE `announcements` ADD `target_branch_id` text;--> statement-breakpoint
ALTER TABLE `announcements` ADD `target_person_email` text;--> statement-breakpoint
ALTER TABLE `announcements` ADD `target_person_name` text;--> statement-breakpoint
INSERT INTO `recipes` (`branch_id`, `name`, `category`, `portions`, `allergens`, `ingredients`, `instructions`, `updated_by`) VALUES
('restaurace-cerna-perla', 'Telecí líčka na víně', 'Hlavní jídlo', 10, '1, 7, 9', '2,5 kg telecích líček\nkořenová zelenina\nčervené víno\ntelecí fond', 'Maso zatáhnout, přidat zeleninu a víno. Pomalu dusit doměkka, omáčku přecedit a zredukovat.', 'vedeni@foodtab.cz'),
('restaurace-cerna-perla', 'Crème brûlée', 'Dezert', 12, '3, 7', 'smetana\nžloutky\nvanilka\ncukr', 'Směs nalít do misek, péct ve vodní lázni a před servisem zkaramelizovat cukr.', 'vedeni@foodtab.cz'),
('bernard-bar-tabor', 'Bernardský hovězí guláš', 'Hlavní jídlo', 10, '1', 'hovězí kližka\ncibule\ntmavé pivo Bernard\nkoření', 'Cibuli opéct do tmava, přidat maso a koření. Podlít pivem a dusit doměkka.', 'vedeni@foodtab.cz'),
('bernard-bar-tabor', 'Nakládaný hermelín', 'K pivu', 8, '7', 'hermelín\ncibule\nčesnek\nchilli\nolej', 'Sýr proložit kořením, zalít olejem a nechat alespoň tři dny zrát v chladu.', 'vedeni@foodtab.cz');--> statement-breakpoint
INSERT INTO `assigned_tasks` (`title`, `note`, `created_by_email`, `created_by_name`, `origin_location`, `audience_type`, `target_branch_id`, `due_at`, `priority`) VALUES
('Předat víkendové objednávky', 'Potvrdit množství sudů a nealko sortimentu.', 'vedeni@foodtab.cz', 'Lucka', 'Foodtab s.r.o. · Celá firma', 'branch', 'bernard-bar-tabor', '2026-08-18T12:00', 'high'),
('Aktualizovat polední nabídku', 'Doplnit alergeny a gramáže.', 'vedeni@foodtab.cz', 'Lucka', 'Foodtab s.r.o. · Celá firma', 'branch', 'restaurace-cerna-perla', '2026-08-18T09:00', 'normal');
