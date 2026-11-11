CREATE TABLE "location" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "location_id_org_uq" UNIQUE("id","org_id")
);
--> statement-breakpoint
CREATE TABLE "product" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" text,
	"barcode" text,
	"unit" text DEFAULT 'pcs' NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"cost_cents" bigint DEFAULT 0 NOT NULL,
	"price_cents" bigint DEFAULT 0 NOT NULL,
	"reorder_point_milli" bigint DEFAULT 0 NOT NULL,
	"reorder_qty_milli" bigint DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_id_org_uq" UNIQUE("id","org_id")
);
--> statement-breakpoint
CREATE TABLE "stock_level" (
	"org_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"quantity_milli" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_level_product_id_location_id_pk" PRIMARY KEY("product_id","location_id")
);
--> statement-breakpoint
CREATE TABLE "stock_movement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"quantity_milli" bigint NOT NULL,
	"balance_after_milli" bigint NOT NULL,
	"reason" text,
	"reference" text,
	"note" text,
	"unit_cost_cents" bigint,
	"transfer_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "location" ADD CONSTRAINT "location_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_level" ADD CONSTRAINT "stock_level_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_level" ADD CONSTRAINT "stock_level_product_fk" FOREIGN KEY ("product_id","org_id") REFERENCES "public"."product"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_level" ADD CONSTRAINT "stock_level_location_fk" FOREIGN KEY ("location_id","org_id") REFERENCES "public"."location"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_product_fk" FOREIGN KEY ("product_id","org_id") REFERENCES "public"."product"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_location_fk" FOREIGN KEY ("location_id","org_id") REFERENCES "public"."location"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "location_name_uq" ON "location" USING btree ("org_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "product_sku_uq" ON "product" USING btree ("org_id",lower("sku"));--> statement-breakpoint
CREATE INDEX "product_org_idx" ON "product" USING btree ("org_id","status","name");--> statement-breakpoint
CREATE INDEX "stock_level_location_idx" ON "stock_level" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "stock_movement_product_idx" ON "stock_movement" USING btree ("product_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "stock_movement_org_idx" ON "stock_movement" USING btree ("org_id","created_at" DESC NULLS LAST);