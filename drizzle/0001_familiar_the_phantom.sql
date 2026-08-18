CREATE TABLE `branches` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
INSERT INTO `branches` (`id`, `name`, `active`) VALUES ('restaurace-cerna-perla', 'Restaurace Černá Perla', true);
--> statement-breakpoint
INSERT INTO `branches` (`id`, `name`, `active`) VALUES ('bernard-bar-tabor', 'Bernard Bar Tábor', true);
