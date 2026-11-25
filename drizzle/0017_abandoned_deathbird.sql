CREATE TABLE "saving_marks" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"goal_id" text NOT NULL,
	"date" text NOT NULL,
	"amount" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "paycheck_bp" integer;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "notify_savings" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "saving_marks" ADD CONSTRAINT "saving_marks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saving_marks" ADD CONSTRAINT "saving_marks_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "saving_marks_goal_date_idx" ON "saving_marks" USING btree ("goal_id","date");--> statement-breakpoint
CREATE INDEX "saving_marks_user_idx" ON "saving_marks" USING btree ("user_id");