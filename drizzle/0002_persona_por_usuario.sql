ALTER TABLE "usuario" ADD COLUMN "persona_atual" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "usuario" ADD CONSTRAINT "usuario_persona_atual_persona_id_fk" FOREIGN KEY ("persona_atual") REFERENCES "public"."persona"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
