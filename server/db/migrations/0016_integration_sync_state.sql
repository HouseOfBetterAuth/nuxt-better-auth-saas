ALTER TABLE "organization" ADD COLUMN IF NOT EXISTS "last_synced_at" timestamp;
DROP INDEX IF EXISTS "integration_org_type_account_idx";
DROP INDEX IF EXISTS "integration_org_type_unique_idx";
CREATE UNIQUE INDEX IF NOT EXISTS "integration_org_type_account_not_null_idx"
  ON "integration" ("organization_id", "type", "account_id")
  WHERE "account_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "integration_org_type_null_account_idx"
  ON "integration" ("organization_id", "type")
  WHERE "account_id" IS NULL;
