-- Drop tables if they exist (they may not exist in all environments)
DROP TABLE IF EXISTS "org_provisioning_queue" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "quota_usage_log" CASCADE;
--> statement-breakpoint
DO $migration$
BEGIN
  -- Add new column first if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user'
      AND column_name = 'default_organization_id'
  ) THEN
    ALTER TABLE "user" ADD COLUMN "default_organization_id" text;
  END IF;

  -- Copy any existing values from last_active_organization_id
  UPDATE "user"
  SET "default_organization_id" = NULLIF(TRIM("last_active_organization_id"), '')
  WHERE "last_active_organization_id" IS NOT NULL
    AND ("default_organization_id" IS NULL OR "default_organization_id" = '');

  -- Drop legacy FK if present before dropping column
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'user_last_active_organization_id_organization_id_fk'
      AND table_schema = 'public'
      AND table_name = 'user'
  ) THEN
    ALTER TABLE "user" DROP CONSTRAINT "user_last_active_organization_id_organization_id_fk";
  END IF;

  -- Drop old column if it exists
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user'
      AND column_name = 'last_active_organization_id'
  ) THEN
    ALTER TABLE "user" DROP COLUMN "last_active_organization_id";
  END IF;
END;
$migration$ LANGUAGE plpgsql;
