CREATE TABLE IF NOT EXISTS "author" (
	"id" text PRIMARY KEY NOT NULL,
	"ig_user_id" text NOT NULL,
	"username" text NOT NULL,
	"full_name" text,
	"followers_count" integer,
	"is_verified" boolean,
	"category" text,
	"biography" text,
	"watch" text,
	"watch_source" text,
	"watch_set_at" bigint,
	"last_watched_at" bigint,
	"first_seen_at" bigint NOT NULL,
	"last_seen_at" bigint NOT NULL,
	CONSTRAINT "author_ig_user_id_unique" UNIQUE("ig_user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "classification" (
	"id" text PRIMARY KEY NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"source" text NOT NULL,
	"model" text,
	"prompt_version" text,
	"output" jsonb NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "collection_run" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text DEFAULT 'explore' NOT NULL,
	"term" text,
	"day_key" text NOT NULL,
	"started_at" bigint NOT NULL,
	"ended_at" bigint,
	"status" text DEFAULT 'running' NOT NULL,
	"cards_seen" integer DEFAULT 0 NOT NULL,
	"cards_new" integer DEFAULT 0 NOT NULL,
	"posts_opened" integer DEFAULT 0 NOT NULL,
	"responses_captured" integer DEFAULT 0 NOT NULL,
	"parse_failures" integer DEFAULT 0 NOT NULL,
	"abort_reason" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "comment" (
	"id" text PRIMARY KEY NOT NULL,
	"post_id" text NOT NULL,
	"ig_comment_id" text NOT NULL,
	"text" text,
	"like_count" integer,
	"created_at" bigint,
	"author_ref" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "discovery" (
	"id" text PRIMARY KEY NOT NULL,
	"post_id" text NOT NULL,
	"run_id" text,
	"raw_response_id" text,
	"source" text NOT NULL,
	"term" text,
	"position" integer,
	"seen_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "encaixe" (
	"id" text PRIMARY KEY NOT NULL,
	"persona_id" text NOT NULL,
	"post_id" text NOT NULL,
	"source" text NOT NULL,
	"encaixe" text NOT NULL,
	"tema" text,
	"tema_territorio" text,
	"angulo" text,
	"radar_tema" text,
	"confianca" double precision,
	"motivo" text,
	"territorio_versao" integer DEFAULT 0 NOT NULL,
	"modelo" text,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "enrichment" (
	"id" text PRIMARY KEY NOT NULL,
	"post_id" text NOT NULL,
	"kind" text NOT NULL,
	"model" text NOT NULL,
	"output" jsonb NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hashtag" (
	"id" text PRIMARY KEY NOT NULL,
	"tag" text NOT NULL,
	CONSTRAINT "hashtag_tag_unique" UNIQUE("tag")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "idea" (
	"id" text PRIMARY KEY NOT NULL,
	"generated_at" bigint NOT NULL,
	"title" text NOT NULL,
	"hook" text,
	"format" text,
	"rationale" text,
	"evidence_post_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"score" double precision,
	"status" text DEFAULT 'new' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ideia" (
	"id" text PRIMARY KEY NOT NULL,
	"persona_id" text NOT NULL,
	"semana" text NOT NULL,
	"tipo" text NOT NULL,
	"ordem" integer DEFAULT 0 NOT NULL,
	"post_id" text,
	"titulo" text NOT NULL,
	"por_que" text,
	"angulo" text,
	"hook" text,
	"formato" text,
	"radar_tema" text,
	"evidencias" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"score" double precision,
	"status" text DEFAULT 'nova' NOT NULL,
	"motivo" text,
	"nota" text,
	"feedback_at" bigint,
	"modelo" text,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "media_asset" (
	"id" text PRIMARY KEY NOT NULL,
	"post_id" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"kind" text NOT NULL,
	"remote_url" text,
	"local_path" text,
	"width" integer,
	"height" integer,
	"duration_s" double precision,
	"downloaded_at" bigint,
	"download_attempts" integer DEFAULT 0 NOT NULL,
	"download_error" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pauta_visto" (
	"persona_id" text NOT NULL,
	"post_id" text NOT NULL,
	"territorio_versao" integer NOT NULL,
	"visto_em" bigint NOT NULL,
	CONSTRAINT "pauta_visto_persona_id_post_id_pk" PRIMARY KEY("persona_id","post_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "persona" (
	"id" text PRIMARY KEY NOT NULL,
	"nome" text NOT NULL,
	"handle" text,
	"publico" text,
	"entrevista" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"territorio" jsonb,
	"territorio_versao" integer DEFAULT 0 NOT NULL,
	"ativa" boolean DEFAULT false NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "persona_conta" (
	"id" text PRIMARY KEY NOT NULL,
	"persona_id" text NOT NULL,
	"username" text NOT NULL,
	"papel" text NOT NULL,
	"source" text NOT NULL,
	"sementes" integer,
	"confianca" double precision,
	"motivo" text,
	"tema" text,
	"candidata_semente" boolean,
	"modelo" text,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "post" (
	"id" text PRIMARY KEY NOT NULL,
	"shortcode" text NOT NULL,
	"ig_media_id" text,
	"author_id" text,
	"media_type" text,
	"caption" text,
	"taken_at" bigint,
	"permalink" text,
	"audio_id" text,
	"audio_title" text,
	"location_name" text,
	"discovery_source" text DEFAULT 'explore' NOT NULL,
	"detail_fetched_at" bigint,
	"first_seen_at" bigint NOT NULL,
	"last_seen_at" bigint NOT NULL,
	CONSTRAINT "post_shortcode_unique" UNIQUE("shortcode")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "post_embedding" (
	"post_id" text NOT NULL,
	"model" text NOT NULL,
	"embedding" jsonb NOT NULL,
	"created_at" bigint NOT NULL,
	CONSTRAINT "post_embedding_post_id_model_pk" PRIMARY KEY("post_id","model")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "post_hashtag" (
	"post_id" text NOT NULL,
	"hashtag_id" text NOT NULL,
	CONSTRAINT "post_hashtag_post_id_hashtag_id_pk" PRIMARY KEY("post_id","hashtag_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "post_metric" (
	"id" text PRIMARY KEY NOT NULL,
	"post_id" text NOT NULL,
	"captured_at" bigint NOT NULL,
	"like_count" integer,
	"comment_count" integer,
	"play_count" integer,
	"is_like_count_hidden" boolean
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "raw_response" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text,
	"url" text NOT NULL,
	"page_url" text,
	"endpoint_kind" text NOT NULL,
	"status" integer NOT NULL,
	"body" jsonb NOT NULL,
	"body_hash" text NOT NULL,
	"captured_at" bigint NOT NULL,
	"parsed_at" bigint
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "referencia" (
	"id" text PRIMARY KEY NOT NULL,
	"persona_id" text NOT NULL,
	"username" text NOT NULL,
	"status" text DEFAULT 'ativa' NOT NULL,
	"origem" text DEFAULT 'voce' NOT NULL,
	"motivo" text,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "roteiro" (
	"id" text PRIMARY KEY NOT NULL,
	"ideia_id" text NOT NULL,
	"persona_id" text NOT NULL,
	"versao" integer DEFAULT 1 NOT NULL,
	"resposta" text,
	"pedido" text,
	"conteudo" jsonb NOT NULL,
	"texto" text,
	"status" text DEFAULT 'rascunho' NOT NULL,
	"modelo" text,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "seguindo" (
	"id" text PRIMARY KEY NOT NULL,
	"semente" text NOT NULL,
	"ig_user_id" text,
	"username" text NOT NULL,
	"full_name" text,
	"is_verified" boolean,
	"is_private" boolean,
	"run_id" text,
	"visto_em" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "semente" (
	"id" text PRIMARY KEY NOT NULL,
	"persona_id" text NOT NULL,
	"username" text NOT NULL,
	"status" text DEFAULT 'confirmada' NOT NULL,
	"origem" text DEFAULT 'voce' NOT NULL,
	"motivo" text,
	"full_name" text,
	"biography" text,
	"following_count" integer,
	"privada" boolean,
	"coletada_em" bigint,
	"tentativa_em" bigint,
	"erro" text,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "comment" ADD CONSTRAINT "comment_post_id_post_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."post"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "discovery" ADD CONSTRAINT "discovery_post_id_post_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."post"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "discovery" ADD CONSTRAINT "discovery_run_id_collection_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."collection_run"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "discovery" ADD CONSTRAINT "discovery_raw_response_id_raw_response_id_fk" FOREIGN KEY ("raw_response_id") REFERENCES "public"."raw_response"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "encaixe" ADD CONSTRAINT "encaixe_persona_id_persona_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."persona"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "encaixe" ADD CONSTRAINT "encaixe_post_id_post_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."post"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "enrichment" ADD CONSTRAINT "enrichment_post_id_post_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."post"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ideia" ADD CONSTRAINT "ideia_persona_id_persona_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."persona"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ideia" ADD CONSTRAINT "ideia_post_id_post_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."post"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "media_asset" ADD CONSTRAINT "media_asset_post_id_post_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."post"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "persona_conta" ADD CONSTRAINT "persona_conta_persona_id_persona_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."persona"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "post" ADD CONSTRAINT "post_author_id_author_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."author"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "post_embedding" ADD CONSTRAINT "post_embedding_post_id_post_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."post"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "post_hashtag" ADD CONSTRAINT "post_hashtag_post_id_post_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."post"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "post_hashtag" ADD CONSTRAINT "post_hashtag_hashtag_id_hashtag_id_fk" FOREIGN KEY ("hashtag_id") REFERENCES "public"."hashtag"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "post_metric" ADD CONSTRAINT "post_metric_post_id_post_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."post"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "raw_response" ADD CONSTRAINT "raw_response_run_id_collection_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."collection_run"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "referencia" ADD CONSTRAINT "referencia_persona_id_persona_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."persona"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "roteiro" ADD CONSTRAINT "roteiro_ideia_id_ideia_id_fk" FOREIGN KEY ("ideia_id") REFERENCES "public"."ideia"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "roteiro" ADD CONSTRAINT "roteiro_persona_id_persona_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."persona"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "seguindo" ADD CONSTRAINT "seguindo_run_id_collection_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."collection_run"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "semente" ADD CONSTRAINT "semente_persona_id_persona_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."persona"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "author_username_idx" ON "author" USING btree ("username");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "classification_target_idx" ON "classification" USING btree ("target_type","target_id","source");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "collection_run_day_idx" ON "collection_run" USING btree ("kind","day_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "collection_run_started_idx" ON "collection_run" USING btree ("started_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "comment_ig_id_idx" ON "comment" USING btree ("ig_comment_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "discovery_post_raw_idx" ON "discovery" USING btree ("post_id","raw_response_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "discovery_term_idx" ON "discovery" USING btree ("source","term");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "discovery_run_idx" ON "discovery" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "encaixe_persona_post_idx" ON "encaixe" USING btree ("persona_id","post_id","source");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "enrichment_post_kind_idx" ON "enrichment" USING btree ("post_id","kind","model");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ideia_semana_idx" ON "ideia" USING btree ("persona_id","semana");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_asset_post_idx" ON "media_asset" USING btree ("post_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "media_asset_unique_idx" ON "media_asset" USING btree ("post_id","position","kind");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "persona_conta_idx" ON "persona_conta" USING btree ("persona_id","username","source");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "post_author_idx" ON "post" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "post_detail_idx" ON "post" USING btree ("detail_fetched_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "post_taken_idx" ON "post" USING btree ("taken_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "post_metric_post_idx" ON "post_metric" USING btree ("post_id","captured_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "raw_response_kind_idx" ON "raw_response" USING btree ("endpoint_kind");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "raw_response_hash_idx" ON "raw_response" USING btree ("body_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "raw_response_run_idx" ON "raw_response" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "raw_response_unparsed_idx" ON "raw_response" USING btree ("parsed_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "referencia_persona_user_idx" ON "referencia" USING btree ("persona_id","username");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "roteiro_ideia_idx" ON "roteiro" USING btree ("ideia_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "seguindo_semente_user_idx" ON "seguindo" USING btree ("semente","username");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "seguindo_user_idx" ON "seguindo" USING btree ("username");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "semente_persona_user_idx" ON "semente" USING btree ("persona_id","username");