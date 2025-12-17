CREATE TYPE "public"."conversation_log_type" AS ENUM('info', 'warning', 'error', 'debug');--> statement-breakpoint
CREATE TYPE "public"."conversation_role" AS ENUM('user', 'assistant', 'system', 'function');--> statement-breakpoint
CREATE TYPE "public"."conversation_status" AS ENUM('active', 'archived', 'completed');--> statement-breakpoint
CREATE TYPE "public"."content_status" AS ENUM('draft', 'in_review', 'ready_for_publish', 'published', 'archived');--> statement-breakpoint
CREATE TYPE "public"."content_type" AS ENUM('blog_post', 'recipe', 'faq_page', 'course', 'how_to');--> statement-breakpoint
CREATE TYPE "public"."publication_status" AS ENUM('pending', 'published', 'failed');--> statement-breakpoint
CREATE TYPE "public"."ingest_status" AS ENUM('pending', 'processing', 'ingested', 'failed');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text,
	"category" text NOT NULL,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"ip_address" text,
	"user_agent" text,
	"status" text DEFAULT 'success' NOT NULL,
	"details" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "apiKey" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"start" text,
	"prefix" text,
	"key" text NOT NULL,
	"user_id" text NOT NULL,
	"refill_interval" integer,
	"refill_amount" integer,
	"last_refill_at" timestamp,
	"enabled" boolean,
	"rate_limit_enabled" boolean,
	"rate_limit_time_window" integer,
	"rate_limit_max" integer,
	"request_count" integer,
	"remaining" integer,
	"last_request" timestamp,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"permissions" text,
	"metadata" text
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"inviter_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"metadata" text,
	"stripe_customer_id" text,
	"referral_code" text,
	CONSTRAINT "organization_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"active_organization_id" text,
	"impersonated_by" text,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "subscription" (
	"id" text PRIMARY KEY NOT NULL,
	"plan" text NOT NULL,
	"reference_id" text NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"status" text DEFAULT 'incomplete',
	"period_start" timestamp,
	"period_end" timestamp,
	"trial_start" timestamp,
	"trial_end" timestamp,
	"cancel_at_period_end" boolean DEFAULT false,
	"seats" integer,
	CONSTRAINT "subscription_seats_check" CHECK ("subscription"."seats" IS NULL OR "subscription"."seats" > 0)
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"role" text,
	"banned" boolean DEFAULT false,
	"ban_reason" text,
	"ban_expires" timestamp,
	"last_active_organization_id" text,
	"referral_code" text,
	"is_anonymous" boolean DEFAULT false,
	CONSTRAINT "user_email_unique" UNIQUE("email"),
	CONSTRAINT "user_referral_code_unique" UNIQUE("referral_code")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"source_content_id" uuid,
	"created_by_user_id" text,
	"status" "conversation_status" DEFAULT 'active' NOT NULL,
	"metadata" jsonb DEFAULT 'null'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"conversation_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"type" "conversation_log_type" DEFAULT 'info' NOT NULL,
	"message" text NOT NULL,
	"payload" jsonb DEFAULT 'null'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_message" (
	"id" uuid PRIMARY KEY NOT NULL,
	"conversation_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"role" "conversation_role" NOT NULL,
	"content" text NOT NULL,
	"payload" jsonb DEFAULT 'null'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chunk" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"source_content_id" uuid NOT NULL,
	"chunk_index" integer NOT NULL,
	"start_char" integer NOT NULL,
	"end_char" integer NOT NULL,
	"text" text NOT NULL,
	"text_preview" text,
	"embedding" jsonb DEFAULT 'null'::jsonb,
	"metadata" jsonb DEFAULT 'null'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_chunk_source_content_chunk_index" UNIQUE("source_content_id","chunk_index")
);
--> statement-breakpoint
CREATE TABLE "content" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"conversation_id" uuid,
	"source_content_id" uuid,
	"created_by_user_id" text NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"status" "content_status" DEFAULT 'draft' NOT NULL,
	"primary_keyword" text,
	"target_locale" text,
	"content_type" "content_type" DEFAULT 'blog_post' NOT NULL,
	"ingest_method" text,
	"current_version_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp,
	"published_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "content_version" (
	"id" uuid PRIMARY KEY NOT NULL,
	"content_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"frontmatter" jsonb DEFAULT 'null'::jsonb,
	"body_mdx" text NOT NULL,
	"body_html" text,
	"sections" jsonb DEFAULT 'null'::jsonb,
	"assets" jsonb DEFAULT 'null'::jsonb,
	"seo_snapshot" jsonb DEFAULT 'null'::jsonb
);
--> statement-breakpoint
CREATE TABLE "publication" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"content_id" uuid NOT NULL,
	"content_version_id" uuid NOT NULL,
	"integration_id" text,
	"external_id" text,
	"status" "publication_status" DEFAULT 'pending' NOT NULL,
	"published_at" timestamp,
	"payload_snapshot" jsonb DEFAULT 'null'::jsonb,
	"response_snapshot" jsonb DEFAULT 'null'::jsonb,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "file" (
	"id" uuid PRIMARY KEY NOT NULL,
	"original_name" text NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"file_type" text NOT NULL,
	"size" bigint NOT NULL,
	"path" text NOT NULL,
	"url" text,
	"storage_provider" text NOT NULL,
	"uploaded_by" uuid,
	"content_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quota_usage_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"quota_limit" integer,
	"used" integer NOT NULL,
	"remaining" integer,
	"profile" text,
	"label" text,
	"unlimited" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_content" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"source_type" text NOT NULL,
	"external_id" text,
	"title" text,
	"source_text" text,
	"metadata" jsonb DEFAULT 'null'::jsonb,
	"ingest_status" "ingest_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apiKey" ADD CONSTRAINT "apiKey_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_active_organization_id_organization_id_fk" FOREIGN KEY ("active_organization_id") REFERENCES "public"."organization"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_reference_id_organization_id_fk" FOREIGN KEY ("reference_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_last_active_organization_id_organization_id_fk" FOREIGN KEY ("last_active_organization_id") REFERENCES "public"."organization"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_source_content_id_source_content_id_fk" FOREIGN KEY ("source_content_id") REFERENCES "public"."source_content"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_log" ADD CONSTRAINT "conversation_log_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_log" ADD CONSTRAINT "conversation_log_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_message" ADD CONSTRAINT "conversation_message_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_message" ADD CONSTRAINT "conversation_message_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chunk" ADD CONSTRAINT "chunk_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chunk" ADD CONSTRAINT "chunk_source_content_id_source_content_id_fk" FOREIGN KEY ("source_content_id") REFERENCES "public"."source_content"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content" ADD CONSTRAINT "content_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content" ADD CONSTRAINT "content_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content" ADD CONSTRAINT "content_source_content_id_source_content_id_fk" FOREIGN KEY ("source_content_id") REFERENCES "public"."source_content"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content" ADD CONSTRAINT "content_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_version" ADD CONSTRAINT "content_version_content_id_content_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."content"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_version" ADD CONSTRAINT "content_version_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication" ADD CONSTRAINT "publication_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication" ADD CONSTRAINT "publication_content_id_content_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."content"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication" ADD CONSTRAINT "publication_content_version_id_content_version_id_fk" FOREIGN KEY ("content_version_id") REFERENCES "public"."content_version"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication" ADD CONSTRAINT "publication_integration_id_account_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."account"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file" ADD CONSTRAINT "file_uploaded_by_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file" ADD CONSTRAINT "file_content_id_content_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."content"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quota_usage_log" ADD CONSTRAINT "quota_usage_log_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_content" ADD CONSTRAINT "source_content_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_content" ADD CONSTRAINT "source_content_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "account_provider_unique_idx" ON "account" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE INDEX "invitation_organizationId_idx" ON "invitation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "invitation_email_idx" ON "invitation" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "invitation_unique_idx" ON "invitation" USING btree ("organization_id","email");--> statement-breakpoint
CREATE INDEX "member_organizationId_idx" ON "member" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "member_userId_idx" ON "member" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "member_unique_idx" ON "member" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "subscription_stripe_customer_id_idx" ON "subscription" USING btree ("stripe_customer_id");--> statement-breakpoint
CREATE INDEX "subscription_stripe_subscription_id_idx" ON "subscription" USING btree ("stripe_subscription_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "conversation_org_idx" ON "conversation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "conversation_source_idx" ON "conversation" USING btree ("source_content_id");--> statement-breakpoint
CREATE INDEX "conversation_log_conversation_idx" ON "conversation_log" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "conversation_log_org_idx" ON "conversation_log" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "conversation_log_type_idx" ON "conversation_log" USING btree ("type");--> statement-breakpoint
CREATE INDEX "conversation_message_conversation_idx" ON "conversation_message" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "conversation_message_org_idx" ON "conversation_message" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "conversation_message_created_idx" ON "conversation_message" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_chunk_organization_id" ON "chunk" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_chunk_source_content_id" ON "chunk" USING btree ("source_content_id");--> statement-breakpoint
CREATE INDEX "content_organization_idx" ON "content" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "content_conversation_idx" ON "content" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "content_status_idx" ON "content" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "content_org_slug_idx" ON "content" USING btree ("organization_id","slug");--> statement-breakpoint
CREATE INDEX "content_org_status_idx" ON "content" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "content_current_version_idx" ON "content" USING btree ("current_version_id");--> statement-breakpoint
CREATE INDEX "content_version_content_idx" ON "content_version" USING btree ("content_id");--> statement-breakpoint
CREATE INDEX "content_version_created_at_idx" ON "content_version" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "content_version_unique_idx" ON "content_version" USING btree ("content_id","version");--> statement-breakpoint
CREATE INDEX "publication_organization_idx" ON "publication" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "publication_content_idx" ON "publication" USING btree ("content_id");--> statement-breakpoint
CREATE INDEX "publication_status_idx" ON "publication" USING btree ("status");--> statement-breakpoint
CREATE INDEX "quota_usage_log_org_idx" ON "quota_usage_log" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "quota_usage_log_created_idx" ON "quota_usage_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "source_content_organization_idx" ON "source_content" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "source_content_type_idx" ON "source_content" USING btree ("source_type");--> statement-breakpoint
CREATE UNIQUE INDEX "source_content_org_type_external_idx" ON "source_content" USING btree ("organization_id","source_type","external_id") WHERE "source_content"."external_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "source_content_org_type_null_external_idx" ON "source_content" USING btree ("organization_id","source_type") WHERE "source_content"."external_id" IS NULL;