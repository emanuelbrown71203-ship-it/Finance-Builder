ALTER TABLE "budgets" ADD COLUMN "rollover_carry" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "budgets" ADD COLUMN "removed_at" timestamp with time zone;