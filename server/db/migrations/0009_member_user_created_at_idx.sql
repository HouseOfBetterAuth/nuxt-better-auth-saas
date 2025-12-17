CREATE INDEX IF NOT EXISTS member_user_created_at_idx
  ON "member" ("user_id", "created_at" ASC, "organization_id");
