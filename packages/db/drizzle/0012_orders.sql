CREATE TABLE "order_settings" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"prefix" text DEFAULT 'SO-' NOT NULL,
	"next_number" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_order" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"number" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"customer_id" uuid NOT NULL,
	"order_date" date NOT NULL,
	"requested_on" date,
	"location_id" uuid,
	"currency" text NOT NULL,
	"subtotal_cents" bigint DEFAULT 0 NOT NULL,
	"tax_cents" bigint DEFAULT 0 NOT NULL,
	"total_cents" bigint DEFAULT 0 NOT NULL,
	"shipping_address" text,
	"notes" text,
	"invoice_id" uuid,
	"cancel_reason" text,
	"confirmed_at" timestamp with time zone,
	"fulfilled_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_order_id_org_uq" UNIQUE("id","org_id")
);
--> statement-breakpoint
CREATE TABLE "sales_order_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"body" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_order_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"product_id" uuid,
	"description" text NOT NULL,
	"quantity_milli" bigint NOT NULL,
	"unit_price_cents" bigint NOT NULL,
	"tax_rate_bp" integer DEFAULT 0 NOT NULL,
	"amount_cents" bigint NOT NULL,
	"tax_cents" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order_settings" ADD CONSTRAINT "order_settings_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order" ADD CONSTRAINT "sales_order_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order" ADD CONSTRAINT "sales_order_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order" ADD CONSTRAINT "sales_order_customer_fk" FOREIGN KEY ("customer_id","org_id") REFERENCES "public"."customer"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order" ADD CONSTRAINT "sales_order_location_fk" FOREIGN KEY ("location_id","org_id") REFERENCES "public"."location"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order" ADD CONSTRAINT "sales_order_invoice_fk" FOREIGN KEY ("invoice_id","org_id") REFERENCES "public"."invoice"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_event" ADD CONSTRAINT "sales_order_event_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_event" ADD CONSTRAINT "sales_order_event_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_event" ADD CONSTRAINT "sales_order_event_order_fk" FOREIGN KEY ("order_id","org_id") REFERENCES "public"."sales_order"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_line" ADD CONSTRAINT "sales_order_line_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_line" ADD CONSTRAINT "sales_order_line_order_fk" FOREIGN KEY ("order_id","org_id") REFERENCES "public"."sales_order"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_line" ADD CONSTRAINT "sales_order_line_product_fk" FOREIGN KEY ("product_id","org_id") REFERENCES "public"."product"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sales_order_number_uq" ON "sales_order" USING btree ("org_id","number");--> statement-breakpoint
CREATE INDEX "sales_order_org_idx" ON "sales_order" USING btree ("org_id","status","order_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "sales_order_customer_idx" ON "sales_order" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "sales_order_event_order_idx" ON "sales_order_event" USING btree ("order_id","created_at");--> statement-breakpoint
CREATE INDEX "sales_order_line_order_idx" ON "sales_order_line" USING btree ("order_id","position");