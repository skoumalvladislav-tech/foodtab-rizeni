CREATE TABLE `weekly_menu_documents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`branch_id` text NOT NULL,
	`week_label` text NOT NULL,
	`file_name` text NOT NULL,
	`object_key` text NOT NULL,
	`file_size` integer NOT NULL,
	`source` text DEFAULT 'dashboard' NOT NULL,
	`status` text DEFAULT 'ready' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`uploaded_by` text NOT NULL,
	`uploaded_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
