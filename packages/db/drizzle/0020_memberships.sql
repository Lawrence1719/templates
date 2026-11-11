CREATE TABLE "membership" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"started_on" date NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"auto_renew" boolean DEFAULT false NOT NULL,
	"card_token" text NOT NULL,
	"paused_on" date,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"reminded_for" date,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_id_org_uq" UNIQUE("id","org_id")
);
--> statement-breakpoint
CREATE TABLE "membership_check_in" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"checked_in_at" timestamp with time zone DEFAULT now() NOT NULL,
	"method" text NOT NULL,
	"checked_in_by" uuid,
	"voided_at" timestamp with time zone,
	"voided_by" uuid
);
--> statement-breakpoint
CREATE TABLE "membership_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"body" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "membership_period" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"start_day" date NOT NULL,
	"end_day" date NOT NULL,
	"price_cents" bigint NOT NULL,
	"currency" text NOT NULL,
	"paid_via" text NOT NULL,
	"invoice_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "membership_plan" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"price_cents" bigint NOT NULL,
	"currency" text NOT NULL,
	"period_unit" text NOT NULL,
	"period_count" integer DEFAULT 1 NOT NULL,
	"visit_limit" integer,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_plan_id_org_uq" UNIQUE("id","org_id")
);
--> statement-breakpoint
CREATE TABLE "membership_settings" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"time_zone" text DEFAULT 'UTC' NOT NULL,
	"check_in_cooldown_minutes" integer DEFAULT 60 NOT NULL,
	"reminder_days" integer DEFAULT 7 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "membership" ADD CONSTRAINT "membership_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership" ADD CONSTRAINT "membership_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership" ADD CONSTRAINT "membership_customer_fk" FOREIGN KEY ("customer_id","org_id") REFERENCES "public"."customer"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership" ADD CONSTRAINT "membership_plan_fk" FOREIGN KEY ("plan_id","org_id") REFERENCES "public"."membership_plan"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_check_in" ADD CONSTRAINT "membership_check_in_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_check_in" ADD CONSTRAINT "membership_check_in_checked_in_by_user_id_fk" FOREIGN KEY ("checked_in_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_check_in" ADD CONSTRAINT "membership_check_in_voided_by_user_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_check_in" ADD CONSTRAINT "membership_check_in_membership_fk" FOREIGN KEY ("membership_id","org_id") REFERENCES "public"."membership"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_event" ADD CONSTRAINT "membership_event_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_event" ADD CONSTRAINT "membership_event_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_event" ADD CONSTRAINT "membership_event_membership_fk" FOREIGN KEY ("membership_id","org_id") REFERENCES "public"."membership"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_period" ADD CONSTRAINT "membership_period_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_period" ADD CONSTRAINT "membership_period_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_period" ADD CONSTRAINT "membership_period_membership_fk" FOREIGN KEY ("membership_id","org_id") REFERENCES "public"."membership"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_period" ADD CONSTRAINT "membership_period_invoice_fk" FOREIGN KEY ("invoice_id","org_id") REFERENCES "public"."invoice"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_plan" ADD CONSTRAINT "membership_plan_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_settings" ADD CONSTRAINT "membership_settings_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "membership_card_uq" ON "membership" USING btree ("card_token");--> statement-breakpoint
CREATE INDEX "membership_org_idx" ON "membership" USING btree ("org_id","status","period_end");--> statement-breakpoint
CREATE INDEX "membership_customer_idx" ON "membership" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "membership_check_in_membership_idx" ON "membership_check_in" USING btree ("membership_id","checked_in_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "membership_check_in_org_idx" ON "membership_check_in" USING btree ("org_id","checked_in_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "membership_event_membership_idx" ON "membership_event" USING btree ("membership_id","created_at");--> statement-breakpoint
CREATE INDEX "membership_period_membership_idx" ON "membership_period" USING btree ("membership_id","start_day");--> statement-breakpoint
CREATE UNIQUE INDEX "membership_plan_name_uq" ON "membership_plan" USING btree ("org_id",lower("name"));