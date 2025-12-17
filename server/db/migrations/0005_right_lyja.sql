DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user' AND column_name = 'is_anonymous' AND is_nullable = 'YES'
  ) THEN
    ALTER TABLE "user" ALTER COLUMN "is_anonymous" SET NOT NULL;
  END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'organization' AND column_name = 'is_anonymous'
  ) THEN
    ALTER TABLE "organization" ADD COLUMN "is_anonymous" boolean DEFAULT false NOT NULL;
  END IF;
END $$;--> statement-breakpoint
