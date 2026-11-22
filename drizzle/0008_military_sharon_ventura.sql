ALTER TABLE "budgets" ADD COLUMN "rollover_since" text;--> statement-breakpoint
ALTER TABLE "budgets" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;