CREATE TABLE `branches` (
	`id` text PRIMARY KEY NOT NULL,
	`database_id` text NOT NULL,
	`name` text NOT NULL,
	`parent_branch_id` text,
	`file_path` text NOT NULL,
	`is_main` integer DEFAULT false NOT NULL,
	`base_schema` text,
	`forked_from_operation_id` text,
	`status` text DEFAULT 'active' NOT NULL,
	`merged_into_branch_id` text,
	`merged_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`database_id`) REFERENCES `databases`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `databases` ADD `active_branch_id` text;--> statement-breakpoint
ALTER TABLE `operations` ADD `branch_id` text;