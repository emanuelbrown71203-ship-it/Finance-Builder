CREATE TABLE "name_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"merchant_key" text NOT NULL,
	"amount" bigint DEFAULT 0 NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "custom_name" text;--> statement-breakpoint
ALTER TABLE "name_rules" ADD CONSTRAINT "name_rules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "name_rules_user_merchant_amount_idx" ON "name_rules" USING btree ("user_id","merchant_key","amount");