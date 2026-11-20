ALTER TABLE "bill_ticks" ADD COLUMN "paid_on" text;--> statement-breakpoint
ALTER TABLE "bill_ticks" ADD COLUMN "confirmed" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "auth_at" timestamp with time zone DEFAULT now() NOT NULL;