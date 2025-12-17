DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'organization' AND column_name = 'device_fingerprint'
  ) THEN
    ALTER TABLE "organization" ADD COLUMN "device_fingerprint" text;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "organization_device_fingerprint_idx"
  ON "organization" ("device_fingerprint");

WITH fingerprint_matches AS (
  SELECT
    id,
    COALESCE(
      (regexp_match(metadata, '"deviceFingerprint":"([^"]+)"'))[1],
      (regexp_match(metadata, '''deviceFingerprint'':''([^'']+)'''))[1]
    ) AS fingerprint
  FROM "organization"
  WHERE metadata IS NOT NULL
    AND metadata LIKE '%deviceFingerprint%'
)
UPDATE "organization" AS o
SET device_fingerprint = fingerprint_matches.fingerprint
FROM fingerprint_matches
WHERE o.id = fingerprint_matches.id
  AND fingerprint_matches.fingerprint IS NOT NULL
  AND o.device_fingerprint IS NULL;
