CREATE TABLE `conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`database_id` text NOT NULL,
	`title` text DEFAULT 'New conversation' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`database_id`) REFERENCES `databases`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `databases` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`path` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`last_used_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `databases_path_unique` ON `databases` (`path`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`meta` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `operations` (
	`id` text PRIMARY KEY NOT NULL,
	`database_id` text NOT NULL,
	`conversation_id` text,
	`status` text DEFAULT 'planned' NOT NULL,
	`intent` text NOT NULL,
	`risk` text DEFAULT 'safe' NOT NULL,
	`plan` text NOT NULL,
	`result` text,
	`schema_before` text,
	`schema_after` text,
	`snapshot_id` text,
	`duration_ms` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`database_id`) REFERENCES `databases`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`database_id` text NOT NULL,
	`operation_id` text,
	`file_path` text NOT NULL,
	`size_bytes` integer DEFAULT 0 NOT NULL,
	`reason` text DEFAULT 'pre-mutation' NOT NULL,
	`consumed` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`database_id`) REFERENCES `databases`(`id`) ON UPDATE no action ON DELETE cascade
);
