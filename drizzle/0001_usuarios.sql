CREATE TABLE IF NOT EXISTS "acesso" (
	"usuario_id" text NOT NULL,
	"persona_id" text NOT NULL,
	CONSTRAINT "acesso_usuario_id_persona_id_pk" PRIMARY KEY("usuario_id","persona_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "usuario" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"nome" text,
	"papel" text DEFAULT 'membro' NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "acesso" ADD CONSTRAINT "acesso_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "acesso" ADD CONSTRAINT "acesso_persona_id_persona_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."persona"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
