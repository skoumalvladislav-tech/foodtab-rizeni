CREATE TABLE `shifts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`branch_id` text NOT NULL,
	`department` text NOT NULL,
	`shift_date` text NOT NULL,
	`start_time` text NOT NULL,
	`end_time` text NOT NULL,
	`employee_user_id` text,
	`employee_name` text NOT NULL,
	`employee_email` text NOT NULL,
	`is_placeholder` integer DEFAULT true NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_shifts_branch_date` ON `shifts` (`branch_id`,`shift_date`);--> statement-breakpoint
CREATE INDEX `idx_shifts_employee_email` ON `shifts` (`employee_email`);