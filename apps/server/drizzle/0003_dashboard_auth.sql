CREATE TABLE `admin_session` (
	`id_hash` text PRIMARY KEY NOT NULL,
	`csrf_token` text NOT NULL,
	`created_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `admin_session_expires_idx` ON `admin_session` (`expires_at`);--> statement-breakpoint
CREATE TABLE `admin_user` (
	`id` integer PRIMARY KEY NOT NULL,
	`password_hash` text NOT NULL,
	`created_at` text NOT NULL
);
