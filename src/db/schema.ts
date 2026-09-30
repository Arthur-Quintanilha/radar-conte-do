import { randomUUID } from 'node:crypto'
import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  uniqueIndex,
  primaryKey,
} from 'drizzle-orm/sqlite-core'

const id = () =>
  text('id')
    .primaryKey()
    .$defaultFn(() => randomUUID())

/* ---------------------------------------------------------------- camada bruta */

export const collectionRun = sqliteTable(
  'collection_run',
  {
    id: id(),
    // explore | search | authors | probe — cada tipo tem orcamento diario proprio
    kind: text('kind').notNull().default('explore'),
    // termo pesquisado, so nas sessoes de busca
    term: text('term'),
    dayKey: text('day_key').notNull(),
    startedAt: integer('started_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    endedAt: integer('ended_at', { mode: 'timestamp' }),
    // running | ok | aborted | failed
    status: text('status').notNull().default('running'),
    cardsSeen: integer('cards_seen').notNull().default(0),
    cardsNew: integer('cards_new').notNull().default(0),
    postsOpened: integer('posts_opened').notNull().default(0),
    responsesCaptured: integer('responses_captured').notNull().default(0),
    parseFailures: integer('parse_failures').notNull().default(0),
    abortReason: text('abort_reason'),
  },
  (t) => ({
    dayIdx: index('collection_run_day_idx').on(t.kind, t.dayKey),
    startedIdx: index('collection_run_started_idx').on(t.startedAt),
  }),
)

export const rawResponse = sqliteTable(
  'raw_response',
  {
    id: id(),
    runId: text('run_id').references(() => collectionRun.id),
    url: text('url').notNull(),
    /**
     * Endereco da pagina que estava aberta quando a resposta chegou.
     * E isto, e nao o endpoint, que diz se o post veio do Explorar:
     * a pagina de perfil dispara os mesmos endpoints com outro conteudo.
     */
    pageUrl: text('page_url'),
    // explore_grid | graphql | media_info | comments | profile | feed
    endpointKind: text('endpoint_kind').notNull(),
    status: integer('status').notNull(),
    body: text('body', { mode: 'json' }).notNull(),
    bodyHash: text('body_hash').notNull(),
    capturedAt: integer('captured_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    parsedAt: integer('parsed_at', { mode: 'timestamp' }),
  },
  (t) => ({
    kindIdx: index('raw_response_kind_idx').on(t.endpointKind),
    hashIdx: index('raw_response_hash_idx').on(t.bodyHash),
    runIdx: index('raw_response_run_idx').on(t.runId),
    unparsedIdx: index('raw_response_unparsed_idx').on(t.parsedAt),
  }),
)

/* ------------------------------------------------------------ entidades */

export const author = sqliteTable(
  'author',
  {
    id: id(),
    igUserId: text('ig_user_id').notNull().unique(),
    username: text('username').notNull(),
    fullName: text('full_name'),
    followersCount: integer('followers_count'),
    isVerified: integer('is_verified', { mode: 'boolean' }),
    category: text('category'),
    biography: text('biography'),
    // acompanhar | ignorar | null (sem decisao). Quem decide e voce, no painel
    watch: text('watch'),
    // quem marcou: voce | ia. A marcacao sua nunca e mexida pela IA
    watchSource: text('watch_source'),
    watchSetAt: integer('watch_set_at', { mode: 'timestamp' }),
    // ultima visita ao perfil pelo `npm run acompanhar`
    lastWatchedAt: integer('last_watched_at', { mode: 'timestamp' }),
    firstSeenAt: integer('first_seen_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    lastSeenAt: integer('last_seen_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => ({ usernameIdx: index('author_username_idx').on(t.username) }),
)

export const post = sqliteTable(
  'post',
  {
    id: id(),
    shortcode: text('shortcode').notNull().unique(),
    igMediaId: text('ig_media_id'),
    authorId: text('author_id').references(() => author.id),
    // image | carousel | video | reel
    mediaType: text('media_type'),
    caption: text('caption'),
    takenAt: integer('taken_at', { mode: 'timestamp' }),
    permalink: text('permalink'),
    audioId: text('audio_id'),
    audioTitle: text('audio_title'),
    locationName: text('location_name'),
    discoverySource: text('discovery_source').notNull().default('explore'),
    detailFetchedAt: integer('detail_fetched_at', { mode: 'timestamp' }),
    firstSeenAt: integer('first_seen_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    lastSeenAt: integer('last_seen_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => ({
    authorIdx: index('post_author_idx').on(t.authorId),
    detailIdx: index('post_detail_idx').on(t.detailFetchedAt),
    takenIdx: index('post_taken_idx').on(t.takenAt),
  }),
)

/**
 * Cada vez que um post apareceu para nos: no Explorar ou nos resultados de
 * uma busca, com o termo e a posicao. O post e um so; as aparicoes sao muitas.
 */
export const discovery = sqliteTable(
  'discovery',
  {
    id: id(),
    postId: text('post_id')
      .notNull()
      .references(() => post.id),
    runId: text('run_id').references(() => collectionRun.id),
    rawResponseId: text('raw_response_id').references(() => rawResponse.id),
    // explore | search
    source: text('source').notNull(),
    term: text('term'),
    // ordem em que apareceu na sessao, comecando em 1
    position: integer('position'),
    seenAt: integer('seen_at', { mode: 'timestamp' }).notNull(),
  },
  (t) => ({
    uniq: uniqueIndex('discovery_post_raw_idx').on(t.postId, t.rawResponseId),
    termIdx: index('discovery_term_idx').on(t.source, t.term),
    runIdx: index('discovery_run_idx').on(t.runId),
  }),
)

/** Serie temporal. Nunca UPDATE: cada observacao e uma linha nova. */
export const postMetric = sqliteTable(
  'post_metric',
  {
    id: id(),
    postId: text('post_id')
      .notNull()
      .references(() => post.id),
    capturedAt: integer('captured_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    likeCount: integer('like_count'),
    commentCount: integer('comment_count'),
    playCount: integer('play_count'),
    isLikeCountHidden: integer('is_like_count_hidden', { mode: 'boolean' }),
  },
  // unique: reprocessar o mesmo payload nao duplica a observacao
  (t) => ({ postIdx: uniqueIndex('post_metric_post_idx').on(t.postId, t.capturedAt) }),
)

export const hashtag = sqliteTable('hashtag', {
  id: id(),
  tag: text('tag').notNull().unique(),
})

export const postHashtag = sqliteTable(
  'post_hashtag',
  {
    postId: text('post_id')
      .notNull()
      .references(() => post.id),
    hashtagId: text('hashtag_id')
      .notNull()
      .references(() => hashtag.id),
  },
  (t) => ({ pk: primaryKey({ columns: [t.postId, t.hashtagId] }) }),
)

export const comment = sqliteTable(
  'comment',
  {
    id: id(),
    postId: text('post_id')
      .notNull()
      .references(() => post.id),
    igCommentId: text('ig_comment_id').notNull(),
    text: text('text'),
    likeCount: integer('like_count'),
    createdAt: integer('created_at', { mode: 'timestamp' }),
    /** hash do handle, nunca o handle. LGPD. */
    authorRef: text('author_ref'),
  },
  (t) => ({ uniq: uniqueIndex('comment_ig_id_idx').on(t.igCommentId) }),
)

export const mediaAsset = sqliteTable(
  'media_asset',
  {
    id: id(),
    postId: text('post_id')
      .notNull()
      .references(() => post.id),
    position: integer('position').notNull().default(0),
    kind: text('kind').notNull(),
    remoteUrl: text('remote_url'),
    localPath: text('local_path'),
    width: integer('width'),
    height: integer('height'),
    durationS: real('duration_s'),
    downloadedAt: integer('downloaded_at', { mode: 'timestamp' }),
    downloadAttempts: integer('download_attempts').notNull().default(0),
    downloadError: text('download_error'),
  },
  (t) => ({
    postIdx: index('media_asset_post_idx').on(t.postId),
    // reprocessar o payload nao duplica o asset, so atualiza a URL
    uniq: uniqueIndex('media_asset_unique_idx').on(t.postId, t.position, t.kind),
  }),
)

/* -------------------------------------------- enriquecimento e recomendacao */

export const enrichment = sqliteTable(
  'enrichment',
  {
    id: id(),
    postId: text('post_id')
      .notNull()
      .references(() => post.id),
    // ocr | transcript | vision | hook | structure
    kind: text('kind').notNull(),
    model: text('model').notNull(),
    output: text('output', { mode: 'json' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  // um resultado por post/tipo/modelo: reprocessar atualiza em vez de duplicar
  (t) => ({ postKindIdx: uniqueIndex('enrichment_post_kind_idx').on(t.postId, t.kind, t.model) }),
)

/**
 * SQLite nao tem pgvector. Guardamos o vetor como JSON e a busca por
 * similaridade e feita em memoria — suficiente ate uns poucos milhares de
 * posts. A Fase 4 migra para Postgres + pgvector se o volume pedir.
 */
export const postEmbedding = sqliteTable(
  'post_embedding',
  {
    postId: text('post_id')
      .notNull()
      .references(() => post.id),
    model: text('model').notNull(),
    embedding: text('embedding', { mode: 'json' }).$type<number[]>().notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => ({ pk: primaryKey({ columns: [t.postId, t.model] }) }),
)

/**
 * Avaliacao de uma conta ou de um post. `source` separa o que a LLM disse
 * (`llm`) da sua correcao (`humano`); a correcao sempre vale sobre a LLM.
 * Conta: { classe, confianca, motivo, sinais }. Post: { relevancia, publico,
 * tema, angulo, confianca, motivo }.
 */
export const classification = sqliteTable(
  'classification',
  {
    id: id(),
    // author | post
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    // llm | humano
    source: text('source').notNull(),
    // quem respondeu: "claude.ai", "claude-haiku-4-5", "voce"...
    model: text('model'),
    promptVersion: text('prompt_version'),
    output: text('output', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => ({
    uniq: uniqueIndex('classification_target_idx').on(t.targetType, t.targetId, t.source),
  }),
)

export const idea = sqliteTable('idea', {
  id: id(),
  generatedAt: integer('generated_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
  title: text('title').notNull(),
  hook: text('hook'),
  format: text('format'),
  rationale: text('rationale'),
  evidencePostIds: text('evidence_post_ids', { mode: 'json' }).$type<string[]>().notNull().default([]),
  score: real('score'),
  // new | used | discarded
  status: text('status').notNull().default('new'),
})
