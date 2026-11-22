CREATE TABLE "player_wins" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"xp" integer NOT NULL,
	"label" text,
	"ref" text NOT NULL,
	"day" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "player_wins" ADD CONSTRAINT "player_wins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "player_wins_user_created_idx" ON "player_wins" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "player_wins_user_kind_day_idx" ON "player_wins" USING btree ("user_id","kind","day");--> statement-breakpoint
CREATE UNIQUE INDEX "player_wins_user_kind_ref_idx" ON "player_wins" USING btree ("user_id","kind","ref");