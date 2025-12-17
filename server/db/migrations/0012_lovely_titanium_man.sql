-- Drop tables if they exist (they may not exist in all environments)
DROP TABLE IF EXISTS "org_provisioning_queue" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "quota_usage_log" CASCADE;
--> statement-breakpoint
-- Drop constraint if it exists (PostgreSQL 9.5+)
ALTER TABLE "user" DROP CONSTRAINT IF EXISTS "user_last_active_organization_id_organization_id_fk";
--> statement-breakpoint
-- Drop old column if it exists
ALTER TABLE "user" DROP COLUMN IF EXISTS "last_active_organization_id";
--> statement-breakpoint
-- Add new column if it doesn't exist
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "default_organization_id" text DEFAULT '' NOT NULL;
