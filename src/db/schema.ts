import { randomUUID } from 'node:crypto'
import {
  pgTable,
  text,
  integer,
  bigint,
  boolean,
  doublePrecision,
  jsonb,
  index,
  uniqueIndex,
  primaryKey,
  customType,
} from 'drizzle-orm/pg-core'

/**
 * Datas ficam como segundos desde 1970 (bigint), igual ao SQLite de antes: o
 * codigo compara datas com numeros em SQL cru em varios lugares. No TypeScript
 * a coluna continua sendo Date.
 */
const ts = customType<{ data: Date; driverData: number | string }>({
  dataType: () => 'bigint',
  toDriver: (d) => Math.floor(d.getTime() / 1000),
  fromDriver: (v) => new Date(Number(v) * 1000),
})

const id = () =>
  text('id')
    .primaryKey()
    .$defaultFn(() => randomUUID())

/* ---------------------------------------------------------------- camada bruta */

export const collectionRun = pgTable(
  'collection_run',
  {
    id: id(),
    // explore | search | authors | probe — cada tipo tem orcamento diario proprio
    kind: text('kind').notNull().default('explore'),
    // termo pesquisado, so nas sessoes de busca
    term: text('term'),
    dayKey: text('day_key').notNull(),
    startedAt: ts('started_at')
      .notNull()
      .$defaultFn(() => new Date()),
    endedAt: ts('ended_at'),
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

export const rawResponse = pgTable(
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
    body: jsonb('body').notNull(),
    bodyHash: text('body_hash').notNull(),
    capturedAt: ts('captured_at')
      .notNull()
      .$defaultFn(() => new Date()),
    parsedAt: ts('parsed_at'),
  },
  (t) => ({
    kindIdx: index('raw_response_kind_idx').on(t.endpointKind),
    hashIdx: index('raw_response_hash_idx').on(t.bodyHash),
    runIdx: index('raw_response_run_idx').on(t.runId),
    unparsedIdx: index('raw_response_unparsed_idx').on(t.parsedAt),
  }),
)

/* ------------------------------------------------------------ entidades */

export const author = pgTable(
  'author',
  {
    id: id(),
    igUserId: text('ig_user_id').notNull().unique(),
    username: text('username').notNull(),
    fullName: text('full_name'),
    followersCount: integer('followers_count'),
    isVerified: boolean('is_verified'),
    category: text('category'),
    biography: text('biography'),
    // acompanhar | ignorar | null (sem decisao). Quem decide e voce, no painel
    watch: text('watch'),
    // quem marcou: voce | ia. A marcacao sua nunca e mexida pela IA
    watchSource: text('watch_source'),
    watchSetAt: ts('watch_set_at'),
    // ultima visita ao perfil pelo `npm run acompanhar`
    lastWatchedAt: ts('last_watched_at'),
    firstSeenAt: ts('first_seen_at')
      .notNull()
      .$defaultFn(() => new Date()),
    lastSeenAt: ts('last_seen_at')
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => ({ usernameIdx: index('author_username_idx').on(t.username) }),
)

export const post = pgTable(
  'post',
  {
    id: id(),
    shortcode: text('shortcode').notNull().unique(),
    igMediaId: text('ig_media_id'),
    authorId: text('author_id').references(() => author.id),
    // image | carousel | video | reel
    mediaType: text('media_type'),
    caption: text('caption'),
    takenAt: ts('taken_at'),
    permalink: text('permalink'),
    audioId: text('audio_id'),
    audioTitle: text('audio_title'),
    locationName: text('location_name'),
    discoverySource: text('discovery_source').notNull().default('explore'),
    detailFetchedAt: ts('detail_fetched_at'),
    firstSeenAt: ts('first_seen_at')
      .notNull()
      .$defaultFn(() => new Date()),
    lastSeenAt: ts('last_seen_at')
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
export const discovery = pgTable(
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
    seenAt: ts('seen_at').notNull(),
  },
  (t) => ({
    uniq: uniqueIndex('discovery_post_raw_idx').on(t.postId, t.rawResponseId),
    termIdx: index('discovery_term_idx').on(t.source, t.term),
    runIdx: index('discovery_run_idx').on(t.runId),
  }),
)

/** Serie temporal. Nunca UPDATE: cada observacao e uma linha nova. */
export const postMetric = pgTable(
  'post_metric',
  {
    id: id(),
    postId: text('post_id')
      .notNull()
      .references(() => post.id),
    capturedAt: ts('captured_at')
      .notNull()
      .$defaultFn(() => new Date()),
    likeCount: integer('like_count'),
    commentCount: integer('comment_count'),
    playCount: integer('play_count'),
    isLikeCountHidden: boolean('is_like_count_hidden'),
  },
  // unique: reprocessar o mesmo payload nao duplica a observacao
  (t) => ({ postIdx: uniqueIndex('post_metric_post_idx').on(t.postId, t.capturedAt) }),
)

export const hashtag = pgTable('hashtag', {
  id: id(),
  tag: text('tag').notNull().unique(),
})

export const postHashtag = pgTable(
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

export const comment = pgTable(
  'comment',
  {
    id: id(),
    postId: text('post_id')
      .notNull()
      .references(() => post.id),
    igCommentId: text('ig_comment_id').notNull(),
    text: text('text'),
    likeCount: integer('like_count'),
    createdAt: ts('created_at'),
    /** hash do handle, nunca o handle. LGPD. */
    authorRef: text('author_ref'),
  },
  (t) => ({ uniq: uniqueIndex('comment_ig_id_idx').on(t.igCommentId) }),
)

export const mediaAsset = pgTable(
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
    durationS: doublePrecision('duration_s'),
    downloadedAt: ts('downloaded_at'),
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

export const enrichment = pgTable(
  'enrichment',
  {
    id: id(),
    postId: text('post_id')
      .notNull()
      .references(() => post.id),
    // ocr | transcript | vision | hook | structure
    kind: text('kind').notNull(),
    model: text('model').notNull(),
    output: jsonb('output').notNull(),
    createdAt: ts('created_at')
      .notNull()
      .$defaultFn(() => new Date()),
  },
  // um resultado por post/tipo/modelo: reprocessar atualiza em vez de duplicar
  (t) => ({ postKindIdx: uniqueIndex('enrichment_post_kind_idx').on(t.postId, t.kind, t.model) }),
)

/** O vetor fica como JSON; a busca por similaridade e feita em memoria. */
export const postEmbedding = pgTable(
  'post_embedding',
  {
    postId: text('post_id')
      .notNull()
      .references(() => post.id),
    model: text('model').notNull(),
    embedding: jsonb('embedding').$type<number[]>().notNull(),
    createdAt: ts('created_at')
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
export const classification = pgTable(
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
    output: jsonb('output').$type<Record<string, unknown>>().notNull(),
    createdAt: ts('created_at')
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => ({
    uniq: uniqueIndex('classification_target_idx').on(t.targetType, t.targetId, t.source),
  }),
)

export const idea = pgTable('idea', {
  id: id(),
  generatedAt: ts('generated_at')
    .notNull()
    .$defaultFn(() => new Date()),
  title: text('title').notNull(),
  hook: text('hook'),
  format: text('format'),
  rationale: text('rationale'),
  evidencePostIds: jsonb('evidence_post_ids').$type<string[]>().notNull().default([]),
  score: doublePrecision('score'),
  // new | used | discarded
  status: text('status').notNull().default('new'),
})

/* ------------------------------------------------ creator: persona e pauta */

/**
 * Um creator que usa o sistema (o Lucas e o cliente zero). So uma fica ativa
 * por vez: e ela que a coleta, o grafo e a pauta atendem.
 */
export const persona = pgTable('persona', {
  id: id(),
  nome: text('nome').notNull(),
  /** @ do Instagram do proprio creator, se tiver. Fica fora do grafo */
  handle: text('handle'),
  /** quem ele quer atrair, nas palavras dele (sai da entrevista) */
  publico: text('publico'),
  /** respostas da entrevista: { chave da pergunta: resposta } */
  entrevista: jsonb('entrevista').$type<Record<string, string>>().notNull().default({}),
  /** ver Territorio em src/creator/tipos.ts */
  territorio: jsonb('territorio').$type<Record<string, unknown> | null>(),
  /** sobe a cada mudanca no territorio: o encaixe dos posts e refeito */
  territorioVersao: integer('territorio_versao').notNull().default(0),
  ativa: boolean('ativa').notNull().default(false),
  createdAt: ts('created_at')
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: ts('updated_at')
    .notNull()
    .$defaultFn(() => new Date()),
})

/**
 * Perfil real de alguem do publico do creator. De quem as sementes seguem sai
 * o que o publico consome.
 */
export const semente = pgTable(
  'semente',
  {
    id: id(),
    personaId: text('persona_id')
      .notNull()
      .references(() => persona.id),
    username: text('username').notNull(),
    // confirmada | sugerida (a IA achou um par no grafo) | rejeitada
    status: text('status').notNull().default('confirmada'),
    // voce | grafo
    origem: text('origem').notNull().default('voce'),
    motivo: text('motivo'),
    fullName: text('full_name'),
    biography: text('biography'),
    followingCount: integer('following_count'),
    privada: boolean('privada'),
    /** ultima coleta da lista de "seguindo" */
    coletadaEm: ts('coletada_em'),
    /** ultima tentativa, deu certo ou nao */
    tentativaEm: ts('tentativa_em'),
    erro: text('erro'),
    createdAt: ts('created_at')
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => ({ uniq: uniqueIndex('semente_persona_user_idx').on(t.personaId, t.username) }),
)

/**
 * Aresta do grafo: a semente segue a conta. Independe da persona: a mesma
 * semente pode servir a dois creators. Nunca apagada; `vistoEm` renova.
 */
export const seguindo = pgTable(
  'seguindo',
  {
    id: id(),
    semente: text('semente').notNull(),
    igUserId: text('ig_user_id'),
    username: text('username').notNull(),
    fullName: text('full_name'),
    isVerified: boolean('is_verified'),
    isPrivate: boolean('is_private'),
    runId: text('run_id').references(() => collectionRun.id),
    vistoEm: ts('visto_em').notNull(),
  },
  (t) => ({
    uniq: uniqueIndex('seguindo_semente_user_idx').on(t.semente, t.username),
    userIdx: index('seguindo_user_idx').on(t.username),
  }),
)

/**
 * O que uma conta seguida pelas sementes e para o creator:
 * consumido (produz conteudo que o publico assiste), par (e o proprio publico:
 * candidata a semente) ou fora. Fonte: grafo (so a contagem), llm ou humano.
 */
export const personaConta = pgTable(
  'persona_conta',
  {
    id: id(),
    personaId: text('persona_id')
      .notNull()
      .references(() => persona.id),
    username: text('username').notNull(),
    // candidata | consumido | par | fora
    papel: text('papel').notNull(),
    // grafo | llm | humano. A correcao humana vale sobre a llm
    source: text('source').notNull(),
    sementes: integer('sementes'),
    confianca: doublePrecision('confianca'),
    motivo: text('motivo'),
    tema: text('tema'),
    candidataSemente: boolean('candidata_semente'),
    modelo: text('modelo'),
    createdAt: ts('created_at')
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => ({ uniq: uniqueIndex('persona_conta_idx').on(t.personaId, t.username, t.source) }),
)

/**
 * O post cabe no territorio do creator? dentro (vira pauta), radar (o publico
 * consome, mas o creator nao declarou o tema) ou fora.
 */
export const encaixe = pgTable(
  'encaixe',
  {
    id: id(),
    personaId: text('persona_id')
      .notNull()
      .references(() => persona.id),
    postId: text('post_id')
      .notNull()
      .references(() => post.id),
    // llm | humano
    source: text('source').notNull(),
    encaixe: text('encaixe').notNull(),
    tema: text('tema'),
    temaTerritorio: text('tema_territorio'),
    angulo: text('angulo'),
    radarTema: text('radar_tema'),
    confianca: doublePrecision('confianca'),
    motivo: text('motivo'),
    territorioVersao: integer('territorio_versao').notNull().default(0),
    modelo: text('modelo'),
    createdAt: ts('created_at')
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => ({ uniq: uniqueIndex('encaixe_persona_post_idx').on(t.personaId, t.postId, t.source) }),
)

/** Uma ideia da pauta semanal, ou um tema do radar. */
export const ideia = pgTable(
  'ideia',
  {
    id: id(),
    personaId: text('persona_id')
      .notNull()
      .references(() => persona.id),
    /** semana ISO, ex.: 2026-W40 */
    semana: text('semana').notNull(),
    // pauta | radar
    tipo: text('tipo').notNull(),
    ordem: integer('ordem').notNull().default(0),
    postId: text('post_id').references(() => post.id),
    titulo: text('titulo').notNull(),
    porQue: text('por_que'),
    angulo: text('angulo'),
    hook: text('hook'),
    formato: text('formato'),
    radarTema: text('radar_tema'),
    evidencias: jsonb('evidencias').$type<string[]>().notNull().default([]),
    score: doublePrecision('score'),
    // nova | aceita | recusada | adotado (radar)
    status: text('status').notNull().default('nova'),
    // tema | tom | ja_falei | ruim
    motivo: text('motivo'),
    nota: text('nota'),
    feedbackAt: ts('feedback_at'),
    modelo: text('modelo'),
    createdAt: ts('created_at')
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => ({ semanaIdx: index('ideia_semana_idx').on(t.personaId, t.semana) }),
)

/**
 * Referencia de conteudo: pessoa que fala do que o creator fala (CEO de
 * software house, founder de produto...). Daqui sai o ASSUNTO da pauta; do
 * grafo das sementes sai o FORMATO que o publico consome.
 */
export const referencia = pgTable(
  'referencia',
  {
    id: id(),
    personaId: text('persona_id')
      .notNull()
      .references(() => persona.id),
    username: text('username').notNull(),
    // ativa | sugerida | pausada
    status: text('status').notNull().default('ativa'),
    // voce | sugestao
    origem: text('origem').notNull().default('voce'),
    motivo: text('motivo'),
    createdAt: ts('created_at')
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => ({ uniq: uniqueIndex('referencia_persona_user_idx').on(t.personaId, t.username) }),
)

/**
 * Roteiro de uma ideia da pauta: o que o creator fala, bloco a bloco. Cada
 * geracao e uma versao nova; a resposta dele a "Pergunta para..." fica junto,
 * porque e dela que sai a historia verdadeira do roteiro.
 */
export const roteiro = pgTable(
  'roteiro',
  {
    id: id(),
    ideiaId: text('ideia_id')
      .notNull()
      .references(() => ideia.id),
    personaId: text('persona_id')
      .notNull()
      .references(() => persona.id),
    versao: integer('versao').notNull().default(1),
    /** a resposta do creator a pergunta do angulo */
    resposta: text('resposta'),
    /** o ajuste pedido nesta versao (ex.: "mais curto") */
    pedido: text('pedido'),
    /** o roteiro estruturado que a IA devolveu */
    conteudo: jsonb('conteudo').$type<Record<string, unknown>>().notNull(),
    /** texto editado a mao; quando existe, vale mais que o conteudo */
    texto: text('texto'),
    // rascunho | gravado
    status: text('status').notNull().default('rascunho'),
    modelo: text('modelo'),
    createdAt: ts('created_at')
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => ({ ideiaIdx: index('roteiro_ideia_idx').on(t.ideiaId) }),
)

/**
 * Posts ja mandados para a IA num "Gerar ideias", por creator e versao do
 * territorio: nao voltam na proxima pauta, a nao ser que falte opcao.
 */
export const pautaVisto = pgTable(
  'pauta_visto',
  {
    personaId: text('persona_id').notNull(),
    postId: text('post_id').notNull(),
    territorioVersao: integer('territorio_versao').notNull(),
    vistoEm: bigint('visto_em', { mode: 'number' }).notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.personaId, t.postId] }) }),
)
