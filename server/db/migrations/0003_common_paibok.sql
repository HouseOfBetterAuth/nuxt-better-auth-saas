DROP INDEX IF EXISTS "conversation_org_updated_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "conversation_message_conv_org_created_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "conversation_message_conv_created_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "content_conv_org_updated_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "content_conversation_updated_idx";--> statement-breakpoint
CREATE INDEX "conversation_message_conv_created_idx" ON "conversation_message" USING btree ("conversation_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "content_conversation_updated_idx" ON "content" USING btree ("conversation_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "conversation_org_updated_idx" ON "conversation" USING btree ("organization_id","updated_at" DESC NULLS LAST);
