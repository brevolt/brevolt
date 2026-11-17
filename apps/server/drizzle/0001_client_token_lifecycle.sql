ALTER TABLE `client` ADD `created_at` text DEFAULT '1970-01-01T00:00:00.000Z' NOT NULL;--> statement-breakpoint
ALTER TABLE `client` ADD `revoked_at` text;