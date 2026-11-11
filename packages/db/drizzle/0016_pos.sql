CREATE TABLE "pos_cash_movement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"shift_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"reason" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pos_payment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"tender" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"tendered_cents" bigint NOT NULL,
	"change_cents" bigint DEFAULT 0 NOT NULL,
	"reference" text
);
--> statement-breakpoint
CREATE TABLE "pos_refund" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"shift_id" uuid NOT NULL,
	"tender" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"reason" text NOT NULL,
	"restocked" boolean NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_refund_id_org_uq" UNIQUE("id","org_id")
);
--> statement-breakpoint
CREATE TABLE "pos_refund_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"refund_id" uuid NOT NULL,
	"sale_line_id" uuid NOT NULL,
	"quantity_milli" bigint NOT NULL,
	"amount_cents" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pos_register" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"location_id" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_register_id_org_uq" UNIQUE("id","org_id")
);
--> statement-breakpoint
CREATE TABLE "pos_sale" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"number" text NOT NULL,
	"client_key" uuid NOT NULL,
	"shift_id" uuid NOT NULL,
	"register_id" uuid NOT NULL,
	"customer_id" uuid,
	"currency" text NOT NULL,
	"subtotal_cents" bigint NOT NULL,
	"discount_cents" bigint NOT NULL,
	"tax_cents" bigint NOT NULL,
	"total_cents" bigint NOT NULL,
	"refunded_cents" bigint DEFAULT 0 NOT NULL,
	"note" text,
	"cashier_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_sale_id_org_uq" UNIQUE("id","org_id")
);
--> statement-breakpoint
CREATE TABLE "pos_sale_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"product_id" uuid,
	"description" text NOT NULL,
	"quantity_milli" bigint NOT NULL,
	"unit_price_cents" bigint NOT NULL,
	"discount_bp" integer DEFAULT 0 NOT NULL,
	"discount_cents" bigint NOT NULL,
	"tax_rate_bp" integer NOT NULL,
	"tax_cents" bigint NOT NULL,
	"total_cents" bigint NOT NULL,
	"refunded_qty_milli" bigint DEFAULT 0 NOT NULL,
	"refunded_cents" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "pos_sale_line_id_org_uq" UNIQUE("id","org_id")
);
--> statement-breakpoint
CREATE TABLE "pos_settings" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"receipt_prefix" text DEFAULT 'R-' NOT NULL,
	"next_number" integer DEFAULT 1 NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"tax_rate_bp" integer DEFAULT 0 NOT NULL,
	"prices_include_tax" boolean DEFAULT true NOT NULL,
	"max_discount_bp" integer DEFAULT 1000 NOT NULL,
	"time_zone" text DEFAULT 'UTC' NOT NULL,
	"receipt_header" text,
	"receipt_footer" text
);
--> statement-breakpoint
CREATE TABLE "pos_shift" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"register_id" uuid NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"opening_float_cents" bigint NOT NULL,
	"opened_by" uuid,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expected_cash_cents" bigint,
	"counted_cash_cents" bigint,
	"variance_cents" bigint,
	"closing_note" text,
	"closed_by" uuid,
	"closed_at" timestamp with time zone,
	CONSTRAINT "pos_shift_id_org_uq" UNIQUE("id","org_id")
);
--> statement-breakpoint
ALTER TABLE "pos_cash_movement" ADD CONSTRAINT "pos_cash_movement_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_cash_movement" ADD CONSTRAINT "pos_cash_movement_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_cash_movement" ADD CONSTRAINT "pos_cash_movement_shift_fk" FOREIGN KEY ("shift_id","org_id") REFERENCES "public"."pos_shift"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_payment" ADD CONSTRAINT "pos_payment_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_payment" ADD CONSTRAINT "pos_payment_sale_fk" FOREIGN KEY ("sale_id","org_id") REFERENCES "public"."pos_sale"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_refund" ADD CONSTRAINT "pos_refund_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_refund" ADD CONSTRAINT "pos_refund_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_refund" ADD CONSTRAINT "pos_refund_sale_fk" FOREIGN KEY ("sale_id","org_id") REFERENCES "public"."pos_sale"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_refund" ADD CONSTRAINT "pos_refund_shift_fk" FOREIGN KEY ("shift_id","org_id") REFERENCES "public"."pos_shift"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_refund_line" ADD CONSTRAINT "pos_refund_line_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_refund_line" ADD CONSTRAINT "pos_refund_line_refund_fk" FOREIGN KEY ("refund_id","org_id") REFERENCES "public"."pos_refund"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_refund_line" ADD CONSTRAINT "pos_refund_line_sale_line_fk" FOREIGN KEY ("sale_line_id","org_id") REFERENCES "public"."pos_sale_line"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_register" ADD CONSTRAINT "pos_register_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_register" ADD CONSTRAINT "pos_register_location_fk" FOREIGN KEY ("location_id","org_id") REFERENCES "public"."location"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_sale" ADD CONSTRAINT "pos_sale_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_sale" ADD CONSTRAINT "pos_sale_cashier_id_user_id_fk" FOREIGN KEY ("cashier_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_sale" ADD CONSTRAINT "pos_sale_shift_fk" FOREIGN KEY ("shift_id","org_id") REFERENCES "public"."pos_shift"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_sale" ADD CONSTRAINT "pos_sale_register_fk" FOREIGN KEY ("register_id","org_id") REFERENCES "public"."pos_register"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_sale" ADD CONSTRAINT "pos_sale_customer_fk" FOREIGN KEY ("customer_id","org_id") REFERENCES "public"."customer"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_sale_line" ADD CONSTRAINT "pos_sale_line_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_sale_line" ADD CONSTRAINT "pos_sale_line_sale_fk" FOREIGN KEY ("sale_id","org_id") REFERENCES "public"."pos_sale"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_sale_line" ADD CONSTRAINT "pos_sale_line_product_fk" FOREIGN KEY ("product_id","org_id") REFERENCES "public"."product"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_settings" ADD CONSTRAINT "pos_settings_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_shift" ADD CONSTRAINT "pos_shift_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_shift" ADD CONSTRAINT "pos_shift_opened_by_user_id_fk" FOREIGN KEY ("opened_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_shift" ADD CONSTRAINT "pos_shift_closed_by_user_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_shift" ADD CONSTRAINT "pos_shift_register_fk" FOREIGN KEY ("register_id","org_id") REFERENCES "public"."pos_register"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pos_cash_movement_shift_idx" ON "pos_cash_movement" USING btree ("shift_id","created_at");--> statement-breakpoint
CREATE INDEX "pos_payment_sale_idx" ON "pos_payment" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "pos_refund_sale_idx" ON "pos_refund" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "pos_refund_shift_idx" ON "pos_refund" USING btree ("shift_id");--> statement-breakpoint
CREATE INDEX "pos_refund_line_refund_idx" ON "pos_refund_line" USING btree ("refund_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pos_register_name_uq" ON "pos_register" USING btree ("org_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "pos_sale_number_uq" ON "pos_sale" USING btree ("org_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "pos_sale_client_key_uq" ON "pos_sale" USING btree ("org_id","client_key");--> statement-breakpoint
CREATE INDEX "pos_sale_org_idx" ON "pos_sale" USING btree ("org_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "pos_sale_shift_idx" ON "pos_sale" USING btree ("shift_id");--> statement-breakpoint
CREATE INDEX "pos_sale_customer_idx" ON "pos_sale" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "pos_sale_line_sale_idx" ON "pos_sale_line" USING btree ("sale_id","position");--> statement-breakpoint
CREATE INDEX "pos_sale_line_product_idx" ON "pos_sale_line" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pos_shift_open_uq" ON "pos_shift" USING btree ("register_id") WHERE "pos_shift"."status" = 'open';--> statement-breakpoint
CREATE INDEX "pos_shift_org_idx" ON "pos_shift" USING btree ("org_id","opened_at" DESC NULLS LAST);