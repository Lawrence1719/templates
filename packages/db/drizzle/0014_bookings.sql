CREATE TABLE "booking" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"resource_id" uuid NOT NULL,
	"customer_id" uuid,
	"customer_name" text NOT NULL,
	"customer_email" text,
	"customer_phone" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"blocked_until" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"source" text DEFAULT 'staff' NOT NULL,
	"notes" text,
	"cancel_reason" text,
	"manage_token" text NOT NULL,
	"ip_hash" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_manage_token_unique" UNIQUE("manage_token"),
	CONSTRAINT "booking_time_check" CHECK ("booking"."starts_at" < "booking"."ends_at" and "booking"."ends_at" <= "booking"."blocked_until")
);
--> statement-breakpoint
CREATE TABLE "booking_hours" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"resource_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"start_minute" smallint NOT NULL,
	"end_minute" smallint NOT NULL,
	CONSTRAINT "booking_hours_range_check" CHECK ("booking_hours"."weekday" between 0 and 6 and "booking_hours"."start_minute" >= 0 and "booking_hours"."end_minute" <= 1440 and "booking_hours"."start_minute" < "booking_hours"."end_minute")
);
--> statement-breakpoint
CREATE TABLE "booking_resource" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"user_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_resource_id_org_uq" UNIQUE("id","org_id")
);
--> statement-breakpoint
CREATE TABLE "booking_service" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"duration_minutes" smallint NOT NULL,
	"buffer_minutes" smallint DEFAULT 0 NOT NULL,
	"price_cents" bigint DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"resource_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_service_id_org_uq" UNIQUE("id","org_id"),
	CONSTRAINT "booking_service_duration_check" CHECK ("booking_service"."duration_minutes" between 5 and 1440 and "booking_service"."buffer_minutes" between 0 and 240)
);
--> statement-breakpoint
CREATE TABLE "booking_settings" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"time_zone" text DEFAULT 'UTC' NOT NULL,
	"slot_minutes" smallint DEFAULT 30 NOT NULL,
	"min_notice_minutes" integer DEFAULT 120 NOT NULL,
	"max_days_ahead" smallint DEFAULT 60 NOT NULL,
	"require_approval" boolean DEFAULT false NOT NULL,
	"public_enabled" boolean DEFAULT false NOT NULL,
	"public_slug" text NOT NULL,
	"cancel_notice_minutes" integer DEFAULT 1440 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_settings_public_slug_unique" UNIQUE("public_slug")
);
--> statement-breakpoint
CREATE TABLE "booking_time_off" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"resource_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_time_off_range_check" CHECK ("booking_time_off"."starts_at" < "booking_time_off"."ends_at")
);
--> statement-breakpoint
ALTER TABLE "booking" ADD CONSTRAINT "booking_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking" ADD CONSTRAINT "booking_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking" ADD CONSTRAINT "booking_service_fk" FOREIGN KEY ("service_id","org_id") REFERENCES "public"."booking_service"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking" ADD CONSTRAINT "booking_resource_fk" FOREIGN KEY ("resource_id","org_id") REFERENCES "public"."booking_resource"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking" ADD CONSTRAINT "booking_customer_fk" FOREIGN KEY ("customer_id","org_id") REFERENCES "public"."customer"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_hours" ADD CONSTRAINT "booking_hours_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_hours" ADD CONSTRAINT "booking_hours_resource_fk" FOREIGN KEY ("resource_id","org_id") REFERENCES "public"."booking_resource"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_resource" ADD CONSTRAINT "booking_resource_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_resource" ADD CONSTRAINT "booking_resource_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_service" ADD CONSTRAINT "booking_service_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_settings" ADD CONSTRAINT "booking_settings_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_time_off" ADD CONSTRAINT "booking_time_off_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_time_off" ADD CONSTRAINT "booking_time_off_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_time_off" ADD CONSTRAINT "booking_time_off_resource_fk" FOREIGN KEY ("resource_id","org_id") REFERENCES "public"."booking_resource"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "booking_org_time_idx" ON "booking" USING btree ("org_id","starts_at");--> statement-breakpoint
CREATE INDEX "booking_resource_time_idx" ON "booking" USING btree ("resource_id","starts_at");--> statement-breakpoint
CREATE INDEX "booking_rate_idx" ON "booking" USING btree ("org_id","ip_hash","created_at");--> statement-breakpoint
CREATE INDEX "booking_hours_resource_idx" ON "booking_hours" USING btree ("resource_id","weekday");--> statement-breakpoint
CREATE INDEX "booking_service_org_idx" ON "booking_service" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "booking_time_off_resource_idx" ON "booking_time_off" USING btree ("resource_id","starts_at");