CREATE INDEX IF NOT EXISTS conversation_org_updated_idx
  ON "conversation" ("organization_id", "updated_at" DESC, "id" DESC);

CREATE INDEX IF NOT EXISTS content_org_updated_idx
  ON "content" ("organization_id", "updated_at" DESC, "id" DESC);

CREATE INDEX IF NOT EXISTS content_org_id_idx
  ON "content" ("organization_id", "id");
