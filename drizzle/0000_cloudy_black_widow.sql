CREATE TABLE `announcements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`author_name` text NOT NULL,
	`author_email` text NOT NULL,
	`role` text DEFAULT 'Vedení' NOT NULL,
	`text` text NOT NULL,
	`location` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `attendance_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_email` text NOT NULL,
	`action` text NOT NULL,
	`location` text NOT NULL,
	`occurred_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `operation_tasks` (
	`id` integer PRIMARY KEY NOT NULL,
	`completed` integer DEFAULT false NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
