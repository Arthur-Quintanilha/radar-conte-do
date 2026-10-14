CREATE TABLE IF NOT EXISTS "uso_ia" (
	"id" text PRIMARY KEY NOT NULL,
	"usuario_id" text,
	"persona_id" text,
	"etapa" text NOT NULL,
	"modelo" text NOT NULL,
	"entrada" integer DEFAULT 0 NOT NULL,
	"saida" integer DEFAULT 0 NOT NULL,
	"cache_leitura" integer DEFAULT 0 NOT NULL,
	"cache_escrita" integer DEFAULT 0 NOT NULL,
	"custo_usd" double precision DEFAULT 0 NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "usuario" ADD COLUMN "limite_ia_usd" double precision;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "uso_ia" ADD CONSTRAINT "uso_ia_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "uso_ia" ADD CONSTRAINT "uso_ia_persona_id_persona_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."persona"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "uso_ia_usuario_idx" ON "uso_ia" USING btree ("usuario_id","created_at");