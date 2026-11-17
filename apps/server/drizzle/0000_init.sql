CREATE TABLE `change_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ts` text NOT NULL,
	`actor` text NOT NULL,
	`contact_id` text NOT NULL,
	`field` text NOT NULL,
	`before` text,
	`after` text,
	`operation_id` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `change_log_contact_idx` ON `change_log` (`contact_id`,`ts`);--> statement-breakpoint
CREATE INDEX `change_log_operation_idx` ON `change_log` (`operation_id`);--> statement-breakpoint
CREATE TABLE `client` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`cursor` text,
	`last_seen` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `client_token_hash_unique` ON `client` (`token_hash`);--> statement-breakpoint
CREATE TABLE `conflict` (
	`id` text PRIMARY KEY NOT NULL,
	`contact_id` text NOT NULL,
	`field` text NOT NULL,
	`system` text NOT NULL,
	`base` text,
	`hub_value` text,
	`external_value` text,
	`status` text DEFAULT 'pending' NOT NULL,
	FOREIGN KEY (`contact_id`) REFERENCES `contact`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `conflict_status_idx` ON `conflict` (`status`);--> statement-breakpoint
CREATE TABLE `contact` (
	`id` text PRIMARY KEY NOT NULL,
	`prefix` text,
	`given_name` text,
	`middle_name` text,
	`family_names` text,
	`suffix` text,
	`nickname` text,
	`company` text,
	`job_title` text,
	`birthday` text,
	`note_md` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE INDEX `contact_updated_at_idx` ON `contact` (`updated_at`);--> statement-breakpoint
CREATE TABLE `contact_field` (
	`id` text PRIMARY KEY NOT NULL,
	`contact_id` text NOT NULL,
	`kind` text NOT NULL,
	`label` text NOT NULL,
	`value` text NOT NULL,
	`normalized` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`contact_id`) REFERENCES `contact`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `contact_field_contact_idx` ON `contact_field` (`contact_id`);--> statement-breakpoint
CREATE INDEX `contact_field_lookup_idx` ON `contact_field` (`kind`,`normalized`);--> statement-breakpoint
CREATE TABLE `contact_tag` (
	`contact_id` text NOT NULL,
	`tag_id` text NOT NULL,
	PRIMARY KEY(`contact_id`, `tag_id`),
	FOREIGN KEY (`contact_id`) REFERENCES `contact`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tag`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `custom_field` (
	`contact_id` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	PRIMARY KEY(`contact_id`, `key`),
	FOREIGN KEY (`contact_id`) REFERENCES `contact`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `external_link` (
	`contact_id` text NOT NULL,
	`system` text NOT NULL,
	`external_id` text NOT NULL,
	`etag` text,
	PRIMARY KEY(`contact_id`, `system`, `external_id`),
	FOREIGN KEY (`contact_id`) REFERENCES `contact`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `external_link_system_external_id_unique` ON `external_link` (`system`,`external_id`);--> statement-breakpoint
CREATE TABLE `sync_base` (
	`contact_id` text NOT NULL,
	`system` text NOT NULL,
	`snapshot` text NOT NULL,
	`hash` text NOT NULL,
	`synced_at` text NOT NULL,
	PRIMARY KEY(`contact_id`, `system`),
	FOREIGN KEY (`contact_id`) REFERENCES `contact`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `tag` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tag_name_unique` ON `tag` (`name`);