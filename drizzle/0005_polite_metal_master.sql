CREATE TABLE `app_users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`full_name` text NOT NULL,
	`auth_provider` text DEFAULT 'email' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`branch_id` text,
	`role` text,
	`permissions_json` text DEFAULT '[]' NOT NULL,
	`requested_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`reviewed_at` text,
	`reviewed_by` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `app_users_email_unique` ON `app_users` (`email`);