ALTER TABLE "subscription" ADD COLUMN "scheduled_plan_id" text;--> statement-breakpoint
ALTER TABLE "subscription" ADD COLUMN "scheduled_plan_interval" text;--> statement-breakpoint
ALTER TABLE "subscription" ADD COLUMN "scheduled_plan_seats" integer;