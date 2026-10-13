import { and, asc, eq, isNull, lt, ne, sql } from 'drizzle-orm'
import { db, run } from '../db/client'
import { author, collectionRun, discovery, enrichment, hashtag, mediaAsset, post, postHashtag, postMetric, rawResponse } from '../db/schema'
import { parseAllMedias, parseProfile, type ParsedAuthor, type ParsedMedia } from './media'
import { config } from '../shared/config'
import { extractFeatures } from './features'
import { isSearchPageUrl, parseSearchPage, searchTermOf } from './search'
import { classify } from '../collector/interceptor'
import { profileFromGraphql } from '../collector/profileExtract'
import { logger } from '../shared/logger'
import { extractFollowing, gravarSeguindo, sementeDaPagina } from './following'

/**
 * Capturas que viram post de Explorar: so o grid do proprio Explorar.
 *
 * Ao abrir /explore/ o Instagram tambem carrega o feed da home
 * (PolarisFeedTimelineRootV2Query, via graphql) por baixo. Aceitar qualquer
 * graphql feito com o Explorar aberto punha posts de quem voce segue no meio
 * do Explorar. O grid (discover/web/explore_grid) e a unica fonte que e
 * realmente o Explorar.
 */
export function isExploreCapture(row: { endpointKind: string; pageUrl: string | null }): boolean {
  if (row.endpointKind !== 'explore_grid') return false
  const path = explorePath(row.pageUrl)
  // resultados de busca, hashtags e locais moram em /explore/... mas nao sao o Explorar
  return path === null || path === '/explore/'
}

const SOURCE_RANK: Record<string, number> = { explore: 3, search: 2, profile: 1 }

const RESERVADOS = new Set(['explore', 'p', 'reel', 'reels', 'stories', 'accounts', 'direct', 'tv', 'about', 'legal', 'developer', 'web', 'api'])

/** Dono do perfil aberto na pagina (instagram.com/<usuario>/...), ou null. */
export function profileUsernameOf(pageUrl: string | null): string | null {
  if (!pageUrl) return null
  try {
    const primeiro = new URL(pageUrl).pathname.split('/').filter(Boolean)[0]
    if (!primeiro || RESERVADOS.has(primeiro.toLowerCase()) || !/^[\w.]+$/.test(primeiro)) return null
    return primeiro.toLowerCase()
  } catch {
    return null
  }
}

/**
 * Captura de uma visita do `npm run acompanhar`: so vale dentro de uma sessao
 * de acompanhamento e na pagina do perfil. Perfis abertos por outros motivos
 * (o sync de seguidores) nunca viram post.
 */
export function isWatchCapture(
  row: { endpointKind: string; pageUrl: string | null; runId: string | null },
  watchRuns: Set<string>,
): string | null {
  if (!row.runId || !watchRuns.has(row.runId)) return null
  if (row.endpointKind !== 'html' && row.endpointKind !== 'graphql') return null
  return profileUsernameOf(row.pageUrl)
}

/**
 * So os posts do proprio dono: o perfil tambem mostra sugestoes e marcacoes.
 * No HTML do perfil a grade as vezes vem sem o autor em cada post; ai, e so
 * ai, aceita o que nao tem autor (`semAutorVale`).
 */
export function ownPosts(medias: ParsedMedia[], username: string, semAutorVale = false): ParsedMedia[] {
  return medias.filter((m) => {
    const dono = m.author?.username?.toLowerCase()
    return dono === username || (semAutorVale && !dono)
  })
}

export async function watchRunIds(): Promise<Set<string>> {
  const rows = await db.select({ id: collectionRun.id }).from(collectionRun).where(eq(collectionRun.kind, 'watch'))
  return new Set(rows.map((r) => r.id))
}

/** Capturas feitas na pagina de resultados de uma busca por palavra. */
export function isSearchCapture(row: { endpointKind: string; pageUrl: string | null }): boolean {
  return row.endpointKind === 'graphql' && isSearchPageUrl(row.pageUrl)
}

function explorePath(pageUrl: string | null): string | null {
  if (!pageUrl) return null
  try {
    const path = new URL(pageUrl).pathname
    return path.endsWith('/') ? path : `${path}/`
  } catch {
    return null
  }
}

export interface ParseSummary {
  rawProcessed: number
  medias: number
  postsNew: number
  postsUpdated: number
  authors: number
  metrics: number
  hashtags: number
  assets: number
  /** capturas descartadas por nao virem do Explorar nem da busca */
  skipped: number
  /** posts vistos em resultados de busca */
  searchMedias: number
  /** posts vistos nas visitas a perfis acompanhados */
  profileMedias: number
  /** contas com seguidores/bio atualizados a partir do graphql do perfil */
  profilesUpdated: number
  appearances: number
  /** arestas semente -> conta seguida gravadas a partir da lista de "seguindo" */
  arestas: number
  failures: number
}

const authorCache = new Map<string, string>()
const hashtagCache = new Map<string, string>()

async function upsertAuthor(parsed: ParsedAuthor): Promise<string> {
  const cached = authorCache.get(parsed.igUserId)
  if (cached) return cached

  // conta marcada a mao antes de aparecer em coleta (npm run marcar): ganha o id real
  // agora, em vez de virar uma segunda linha com o mesmo @
  await run(sql`update author set ig_user_id = ${parsed.igUserId}
    where ig_user_id = ${'pendente:' + parsed.username.toLowerCase()}
      and not exists (select 1 from author a2 where a2.ig_user_id = ${parsed.igUserId})`)

  const rows = await db
    .insert(author)
    .values({
      igUserId: parsed.igUserId,
      username: parsed.username,
      fullName: parsed.fullName ?? null,
      isVerified: parsed.isVerified ?? null,
      followersCount: parsed.followersCount ?? null,
    })
    .onConflictDoUpdate({
      target: author.igUserId,
      set: {
        username: parsed.username,
        lastSeenAt: new Date(),
        // so sobrescreve quando o payload realmente trouxe o campo
        ...(parsed.fullName !== undefined ? { fullName: parsed.fullName } : {}),
        ...(parsed.isVerified !== undefined ? { isVerified: parsed.isVerified } : {}),
        ...(parsed.followersCount !== undefined ? { followersCount: parsed.followersCount } : {}),
      },
    })
    .returning({ id: author.id })

  const id = rows[0]?.id
  if (!id) throw new Error(`upsert de autor falhou: ${parsed.username}`)
  authorCache.set(parsed.igUserId, id)
  return id
}

async function hashtagId(tag: string): Promise<string> {
  const cached = hashtagCache.get(tag)
  if (cached) return cached

  const inserted = await db
    .insert(hashtag)
    .values({ tag })
    .onConflictDoNothing({ target: hashtag.tag })
    .returning({ id: hashtag.id })

  let id = inserted[0]?.id
  if (!id) {
    const existing = await db.select({ id: hashtag.id }).from(hashtag).where(eq(hashtag.tag, tag)).limit(1)
    id = existing[0]?.id
  }
  if (!id) throw new Error(`upsert de hashtag falhou: ${tag}`)
  hashtagCache.set(tag, id)
  return id
}

interface MediaResult {
  postId: string
  isNew: boolean
  metricInserted: boolean
  hashtagsLinked: number
  assetsSaved: number
  authorTouched: boolean
}

async function persistMedia(
  media: ParsedMedia,
  source: string,
  observedAt: Date,
): Promise<MediaResult> {
  let authorId: string | null = null
  if (media.author) authorId = await upsertAuthor(media.author)

  const existing = await db
    .select({ id: post.id, discoverySource: post.discoverySource })
    .from(post)
    .where(eq(post.shortcode, media.shortcode))
    .limit(1)

  const fields = {
    igMediaId: media.igMediaId ?? null,
    authorId,
    mediaType: media.mediaType ?? null,
    caption: media.caption ?? null,
    takenAt: media.takenAt ?? null,
    permalink: `https://www.instagram.com/p/${media.shortcode}/`,
    audioId: media.audioId ?? null,
    audioTitle: media.audioTitle ?? null,
    locationName: media.locationName ?? null,
    lastSeenAt: observedAt,
  }

  let postId = existing[0]?.id
  const isNew = postId === undefined

  if (postId === undefined) {
    const rows = await db
      .insert(post)
      .values({ shortcode: media.shortcode, discoverySource: source, ...fields })
      .onConflictDoNothing({ target: post.shortcode })
      .returning({ id: post.id })
    postId = rows[0]?.id

    if (postId === undefined) {
      const again = await db
        .select({ id: post.id })
        .from(post)
        .where(eq(post.shortcode, media.shortcode))
        .limit(1)
      postId = again[0]?.id
    }
  } else {
    // origem principal: Explorar > busca > perfil. Um post achado na busca
    // continua "da busca" mesmo que depois apareca na visita ao perfil
    const knownSource = existing[0]?.discoverySource ?? 'unknown'
    const sourceFix = (SOURCE_RANK[source] ?? 0) > (SOURCE_RANK[knownSource] ?? 0) ? { discoverySource: source } : {}
    await db.update(post).set({ ...fields, ...sourceFix }).where(eq(post.id, postId))
  }

  if (postId === undefined) throw new Error(`nao consegui resolver o post ${media.shortcode}`)

  let metricInserted = false
  const hasMetric =
    media.likeCount !== undefined || media.commentCount !== undefined || media.playCount !== undefined

  if (hasMetric) {
    const rows = await db
      .insert(postMetric)
      .values({
        postId,
        capturedAt: observedAt,
        likeCount: media.likeCount ?? null,
        commentCount: media.commentCount ?? null,
        playCount: media.playCount ?? null,
        isLikeCountHidden: media.likeCountHidden ?? null,
      })
      .onConflictDoNothing()
      .returning({ id: postMetric.id })
    metricInserted = rows.length > 0
  }

  let hashtagsLinked = 0
  for (const tag of media.hashtags) {
    const tagId = await hashtagId(tag)
    await db.insert(postHashtag).values({ postId, hashtagId: tagId }).onConflictDoNothing()
    hashtagsLinked++
  }

  // features deterministicas: sem modelo, sem custo, disponiveis na hora
  const features = extractFeatures({
    caption: media.caption,
    takenAt: media.takenAt,
    originalWidth: media.originalWidth,
    originalHeight: media.originalHeight,
    carouselCount: media.carouselCount,
    hasAudio: media.hasAudio,
    videoDurationS: media.videoDurationS,
    isPaidPartnership: media.isPaidPartnership,
    repostCount: media.repostCount,
    usertagCount: media.usertagCount,
    locationName: media.locationName,
  })

  await db
    .insert(enrichment)
    .values({ postId, kind: 'features', model: 'deterministic', output: features })
    .onConflictDoUpdate({
      target: [enrichment.postId, enrichment.kind, enrichment.model],
      set: { output: features, createdAt: new Date() },
    })

  let assetsSaved = 0
  for (const asset of media.assets) {
    await db
      .insert(mediaAsset)
      .values({
        postId,
        position: asset.position,
        kind: asset.kind,
        remoteUrl: asset.url,
        width: asset.width ?? null,
        height: asset.height ?? null,
        durationS: asset.durationS ?? null,
      })
      .onConflictDoUpdate({
        target: [mediaAsset.postId, mediaAsset.position, mediaAsset.kind],
        // a URL do CDN muda entre capturas; o arquivo ja baixado continua valendo
        set: {
          remoteUrl: asset.url,
          width: asset.width ?? null,
          height: asset.height ?? null,
          // URL nova ganha tentativas novas: sem isso, um asset que esgotou as
          // 3 tentativas com a URL expirada nunca mais seria baixado, mesmo que
          // o post reaparecesse no Explorar com um link valido
          downloadAttempts: sql`case when ${mediaAsset.remoteUrl} = ${asset.url} or ${mediaAsset.localPath} is not null then ${mediaAsset.downloadAttempts} else 0 end`,
          downloadError: sql`case when ${mediaAsset.remoteUrl} = ${asset.url} or ${mediaAsset.localPath} is not null then ${mediaAsset.downloadError} else null end`,
        },
      })
    assetsSaved++
  }

  // o alt text do proprio Instagram e um sinal de graca
  if (media.altText) {
    await db
      .insert(enrichment)
      .values({ postId, kind: 'alt_text', model: 'instagram', output: { text: media.altText } })
      .onConflictDoUpdate({
        target: [enrichment.postId, enrichment.kind, enrichment.model],
        set: { output: { text: media.altText }, createdAt: new Date() },
      })
  }

  return { postId, isNew, metricInserted, hashtagsLinked, assetsSaved, authorTouched: authorId !== null }
}

/**
 * Quantos posts ja apareceram antes desta captura na mesma sessao, para a
 * posicao continuar contando entre as paginas da busca. Olha so capturas
 * anteriores, entao reprocessar da o mesmo numero.
 */
async function positionOffset(
  row: { id: string; runId: string | null; capturedAt: Date },
  source: string,
  term: string | null,
): Promise<number> {
  if (!row.runId) return 0
  const rows = await db
    .select({ n: sql<number>`count(*)` })
    .from(discovery)
    .innerJoin(rawResponse, eq(rawResponse.id, discovery.rawResponseId))
    .where(
      and(
        eq(discovery.runId, row.runId),
        eq(discovery.source, source),
        term === null ? isNull(discovery.term) : eq(discovery.term, term),
        lt(rawResponse.capturedAt, row.capturedAt),
        ne(rawResponse.id, row.id),
      ),
    )
  return rows[0]?.n ?? 0
}

/**
 * Le as respostas brutas ainda nao processadas e materializa as entidades.
 * Idempotente: reprocessar o mesmo payload nao duplica metrica nem hashtag.
 */
export async function parsePending(limit = 500): Promise<ParseSummary> {
  const rows = await db
    .select()
    .from(rawResponse)
    .where(isNull(rawResponse.parsedAt))
    .orderBy(asc(rawResponse.capturedAt))
    .limit(limit)

  const summary: ParseSummary = {
    rawProcessed: 0,
    medias: 0,
    postsNew: 0,
    postsUpdated: 0,
    authors: 0,
    metrics: 0,
    hashtags: 0,
    assets: 0,
    skipped: 0,
    searchMedias: 0,
    profileMedias: 0,
    profilesUpdated: 0,
    appearances: 0,
    arestas: 0,
    failures: 0,
  }

  const watchRuns = await watchRunIds()

  for (const row of rows) {
    try {
      // perfil aberto (sync de seguidores ou acompanhamento): o graphql traz o
      // `data.user` completo. So atualiza conta que ja esta no banco
      const perfil = row.endpointKind === 'graphql' ? profileFromGraphql(row.body) : null
      if (perfil) {
        await db
          .update(author)
          .set({
            followersCount: perfil.followersCount ?? null,
            ...(perfil.fullName !== undefined ? { fullName: perfil.fullName } : {}),
            ...(perfil.isVerified !== undefined ? { isVerified: perfil.isVerified } : {}),
            ...(perfil.biography !== undefined ? { biography: perfil.biography } : {}),
            ...(perfil.category !== undefined ? { category: perfil.category } : {}),
          })
          .where(sql`lower(${author.username}) = ${perfil.username.toLowerCase()}`)
        summary.profilesUpdated++
      }

      const dona = sementeDaPagina(row.pageUrl, row.endpointKind)
      if (dona && (row.endpointKind === 'following' || row.endpointKind === 'graphql')) {
        // lista de "seguindo" de uma semente: vira aresta do grafo, nunca post
        const users = extractFollowing(row.body, row.endpointKind === 'following')
        if (users.length) summary.arestas += await gravarSeguindo(dona, users, row.runId, row.capturedAt)
        else summary.skipped++
      } else if (row.endpointKind === 'profile') {
        const profile = parseProfile(row.body)
        if (profile) await upsertAuthor(profile)
      } else {
        let source: 'explore' | 'search' | 'profile' | null = null
        let term: string | null = null
        let medias: ParsedMedia[] = []

        if (isExploreCapture(row)) {
          source = 'explore'
          medias = parseAllMedias(row.body, config.ENRICH_TARGET_WIDTH)
        } else if (isSearchCapture(row)) {
          // na pagina de busca tambem chegam badge, stories, promocoes: so a SERP conta
          const page = parseSearchPage(row.body, config.ENRICH_TARGET_WIDTH)
          if (page) {
            source = 'search'
            term = searchTermOf(row.pageUrl)
            medias = page.medias
            summary.searchMedias += medias.length
          }
        } else {
          const dono = isWatchCapture(row, watchRuns)
          if (dono) {
            source = 'profile'
            medias = ownPosts(parseAllMedias(row.body, config.ENRICH_TARGET_WIDTH), dono, row.endpointKind === 'html')
            summary.profileMedias += medias.length
          }
        }

        if (!source) {
          summary.skipped++
        } else {
          summary.medias += medias.length
          let position = await positionOffset(row, source, term)

          for (const media of medias) {
            const result = await persistMedia(media, source, row.capturedAt)
            if (result.isNew) summary.postsNew++
            else summary.postsUpdated++
            if (result.metricInserted) summary.metrics++
            summary.hashtags += result.hashtagsLinked
            summary.assets += result.assetsSaved

            position++
            await db
              .insert(discovery)
              .values({
                postId: result.postId,
                runId: row.runId,
                rawResponseId: row.id,
                source,
                term,
                position,
                seenAt: row.capturedAt,
              })
              .onConflictDoUpdate({
                target: [discovery.postId, discovery.rawResponseId],
                set: { position, term, source },
              })
            summary.appearances++
          }
        }
      }

      await db.update(rawResponse).set({ parsedAt: new Date() }).where(eq(rawResponse.id, row.id))
      summary.rawProcessed++
    } catch (error) {
      summary.failures++
      logger.warn({ rawId: row.id, kind: row.endpointKind, error }, 'falha ao processar resposta bruta')
    }
  }

  summary.authors = authorCache.size
  authorCache.clear()
  hashtagCache.clear()
  return summary
}

/**
 * Reabre tudo para reprocessamento apos mudar o parser. Reclassifica o
 * endpoint com a regra atual: capturas antigas (ex.: a busca gravada pela
 * sonda como `other`) passam a ser lidas pelo parser certo.
 */
export async function resetParsed(): Promise<number> {
  const rows = await db.select({ id: rawResponse.id, url: rawResponse.url, kind: rawResponse.endpointKind }).from(rawResponse)
  for (const row of rows) {
    const kind = classify(row.url)
    if (kind && kind !== row.kind) {
      await db.update(rawResponse).set({ endpointKind: kind }).where(eq(rawResponse.id, row.id))
    }
  }
  const reopened = await db.update(rawResponse).set({ parsedAt: null }).returning({ id: rawResponse.id })
  return reopened.length
}
