CREATE TABLE "employee" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid,
	"name" text NOT NULL,
	"work_email" text,
	"phone" text,
	"job_title" text,
	"department_id" uuid,
	"manager_id" uuid,
	"employment_type" text DEFAULT 'full_time' NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"status" text DEFAULT 'active' NOT NULL,
	"pay_type" text,
	"pay_rate_cents" bigint,
	"pay_currency" text,
	"birth_date" date,
	"home_address" text,
	"emergency_contact_name" text,
	"emergency_contact_phone" text,
	"private_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employee_id_org_uq" UNIQUE("id","org_id")
);
--> statement-breakpoint
CREATE TABLE "hr_department" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hr_department_id_org_uq" UNIQUE("id","org_id")
);
--> statement-breakpoint
CREATE TABLE "hr_holiday" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"day" date NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_settings" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"time_zone" text DEFAULT 'UTC' NOT NULL,
	"work_days" integer[] DEFAULT '{1,2,3,4,5}' NOT NULL,
	"leave_year_start_month" integer DEFAULT 1 NOT NULL,
	"weekly_hours" integer DEFAULT 40 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leave_adjustment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"leave_type_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"half_days" integer NOT NULL,
	"reason" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leave_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"leave_type_id" uuid NOT NULL,
	"start_day" date NOT NULL,
	"end_day" date NOT NULL,
	"half_day" boolean DEFAULT false NOT NULL,
	"half_days" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reason" text,
	"decision_note" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leave_type" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"allowance_half_days" integer,
	"paid" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leave_type_id_org_uq" UNIQUE("id","org_id")
);
--> statement-breakpoint
CREATE TABLE "time_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"clock_in" timestamp with time zone NOT NULL,
	"clock_out" timestamp with time zone,
	"note" text,
	"source" text DEFAULT 'clock' NOT NULL,
	"created_by" uuid,
	"edited_by" uuid,
	"edited_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "employee" ADD CONSTRAINT "employee_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee" ADD CONSTRAINT "employee_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee" ADD CONSTRAINT "employee_department_fk" FOREIGN KEY ("department_id","org_id") REFERENCES "public"."hr_department"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee" ADD CONSTRAINT "employee_manager_fk" FOREIGN KEY ("manager_id","org_id") REFERENCES "public"."employee"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_department" ADD CONSTRAINT "hr_department_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_holiday" ADD CONSTRAINT "hr_holiday_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_settings" ADD CONSTRAINT "hr_settings_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_adjustment" ADD CONSTRAINT "leave_adjustment_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_adjustment" ADD CONSTRAINT "leave_adjustment_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_adjustment" ADD CONSTRAINT "leave_adjustment_employee_fk" FOREIGN KEY ("employee_id","org_id") REFERENCES "public"."employee"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_adjustment" ADD CONSTRAINT "leave_adjustment_type_fk" FOREIGN KEY ("leave_type_id","org_id") REFERENCES "public"."leave_type"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_request" ADD CONSTRAINT "leave_request_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_request" ADD CONSTRAINT "leave_request_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_request" ADD CONSTRAINT "leave_request_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_request" ADD CONSTRAINT "leave_request_employee_fk" FOREIGN KEY ("employee_id","org_id") REFERENCES "public"."employee"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_request" ADD CONSTRAINT "leave_request_type_fk" FOREIGN KEY ("leave_type_id","org_id") REFERENCES "public"."leave_type"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_type" ADD CONSTRAINT "leave_type_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_edited_by_user_id_fk" FOREIGN KEY ("edited_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_employee_fk" FOREIGN KEY ("employee_id","org_id") REFERENCES "public"."employee"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "employee_user_uq" ON "employee" USING btree ("org_id","user_id") WHERE "employee"."user_id" is not null;--> statement-breakpoint
CREATE INDEX "employee_org_idx" ON "employee" USING btree ("org_id","status","name");--> statement-breakpoint
CREATE UNIQUE INDEX "hr_department_name_uq" ON "hr_department" USING btree ("org_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "hr_holiday_day_uq" ON "hr_holiday" USING btree ("org_id","day");--> statement-breakpoint
CREATE INDEX "leave_adjustment_employee_idx" ON "leave_adjustment" USING btree ("employee_id","year");--> statement-breakpoint
CREATE INDEX "leave_request_employee_idx" ON "leave_request" USING btree ("employee_id","start_day" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "leave_request_org_idx" ON "leave_request" USING btree ("org_id","status","start_day");--> statement-breakpoint
CREATE UNIQUE INDEX "leave_type_name_uq" ON "leave_type" USING btree ("org_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "time_entry_open_uq" ON "time_entry" USING btree ("employee_id") WHERE "time_entry"."clock_out" is null;--> statement-breakpoint
CREATE INDEX "time_entry_employee_idx" ON "time_entry" USING btree ("employee_id","clock_in" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "time_entry_org_idx" ON "time_entry" USING btree ("org_id","clock_in" DESC NULLS LAST);