ALTER TABLE "user"
DROP COLUMN IF EXISTS "last_active_organization_id";

DROP TABLE IF EXISTS "org_provisioning_queue";
