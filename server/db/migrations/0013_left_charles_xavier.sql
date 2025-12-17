DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user'
      AND column_name = 'default_organization_id'
      AND column_default IS NOT NULL
  ) THEN
    EXECUTE 'ALTER TABLE "user" ALTER COLUMN "default_organization_id" DROP DEFAULT';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user'
      AND column_name = 'default_organization_id'
      AND is_nullable = 'NO'
  ) THEN
    EXECUTE 'ALTER TABLE "user" ALTER COLUMN "default_organization_id" DROP NOT NULL';
  END IF;
END;
$migration$ LANGUAGE plpgsql;--> statement-breakpoint
UPDATE "user" AS u
SET "default_organization_id" = NULL
WHERE "default_organization_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "organization" AS o
    WHERE o."id" = u."default_organization_id"
  );--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_default_organization_id_organization_id_fk" FOREIGN KEY ("default_organization_id") REFERENCES "public"."organization"("id") ON DELETE set null ON UPDATE no action;
