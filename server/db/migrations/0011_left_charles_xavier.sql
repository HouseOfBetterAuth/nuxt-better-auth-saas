ALTER TABLE "user" ALTER COLUMN "default_organization_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "default_organization_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_default_organization_id_organization_id_fk" FOREIGN KEY ("default_organization_id") REFERENCES "public"."organization"("id") ON DELETE set null ON UPDATE no action;