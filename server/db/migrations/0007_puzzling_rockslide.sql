-- Step 1: Backfill any NULL values to 'pending'
UPDATE audit_log_queue SET status = 'pending' WHERE status IS NULL;

-- Step 2: Create the enum type (skip if already exists - type creation handled separately)
-- CREATE TYPE "public"."audit_log_status" AS ENUM('pending', 'success', 'failure');

-- Step 3: Drop old default before type conversion
ALTER TABLE "audit_log_queue"
  ALTER COLUMN "status" DROP DEFAULT;

-- Step 4: Convert the column to enum type
ALTER TABLE "audit_log_queue"
  ALTER COLUMN "status" SET DATA TYPE "public"."audit_log_status"
  USING CASE
    WHEN status = 'pending' THEN 'pending'::"public"."audit_log_status"
    WHEN status = 'success' THEN 'success'::"public"."audit_log_status"
    WHEN status = 'failure' THEN 'failure'::"public"."audit_log_status"
    ELSE 'pending'::"public"."audit_log_status"
  END;

-- Step 5: Set new default
ALTER TABLE "audit_log_queue"
  ALTER COLUMN "status" SET DEFAULT 'pending'::"public"."audit_log_status";
