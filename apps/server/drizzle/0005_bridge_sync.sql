CREATE TABLE `bridge_operation` (
	`client_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`outcome` text NOT NULL,
	`contact_id` text,
	`created_at` text NOT NULL,
	PRIMARY KEY(`client_id`, `operation_id`),
	FOREIGN KEY (`client_id`) REFERENCES `client`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `bridge_pending` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`kind` text NOT NULL,
	`local_id` text,
	`payload` text,
	`hash` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`error` text,
	`created_at` text NOT NULL,
	`acked_at` text,
	FOREIGN KEY (`client_id`) REFERENCES `client`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bridge_pending_operation_unique` ON `bridge_pending` (`client_id`,`operation_id`);--> statement-breakpoint
CREATE INDEX `bridge_pending_status_idx` ON `bridge_pending` (`client_id`,`status`,`seq`);--> statement-breakpoint
CREATE INDEX `bridge_pending_contact_idx` ON `bridge_pending` (`client_id`,`contact_id`);