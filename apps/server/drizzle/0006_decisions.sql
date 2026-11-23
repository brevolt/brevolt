CREATE TABLE `proposal` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`system` text NOT NULL,
	`contact_id` text NOT NULL,
	`external_id` text,
	`external_snapshot` text,
	`reason` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text NOT NULL,
	`resolved_at` text,
	FOREIGN KEY (`contact_id`) REFERENCES `contact`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `proposal_status_idx` ON `proposal` (`status`);--> statement-breakpoint
CREATE INDEX `proposal_contact_idx` ON `proposal` (`contact_id`);--> statement-breakpoint
ALTER TABLE `conflict` ADD `resolution` text;--> statement-breakpoint
ALTER TABLE `conflict` ADD `resolved_value` text;--> statement-breakpoint
ALTER TABLE `conflict` ADD `resolved_at` text;