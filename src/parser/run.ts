import { asc, eq, isNull, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { author, enrichment, hashtag, mediaAsset, post, postHashtag, postMetric, rawResponse } from '../db/schema'
import { parseAllMedias, parseProfile, type ParsedAuthor, type ParsedMedia } from './media'
import { config } from '../shared/config'
import { extractFeatures } from './features'
import { logger } from '../shared/logger'

/**
 * Só viram post as capturas feitas no Explorar.
 *
 * O mesmo endpoint graphql serve o Explorar, o feed da home e a pagina de
 * perfil. Confiar no endpoint enche o banco de posts das contas visitadas,
 * que e um censo de perfis e nao descoberta. A procedencia esta na pagina
 * que estava aberta na hora da captura.
 */
export function isExploreCapture(row: { endpointKind: string; pageUrl: string | null }): boolean {
  if (row.endpointKind === 'explore_grid') return true
  return (row.pageUrl ?? '').includes('/explore')
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
  /** capturas descartadas por nao virem do Explorar */
  skipped: number
  failures: number
}

const authorCache = new Map<string, string>()
const hashtagCache = new Map<string, string>()

async function upsertAuthor(parsed: ParsedAuthor): Promise<string> {
  const cached = authorCache.get(parsed.igUserId)
  if (cached) return cached

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
    const knownSource = existing[0]?.discoverySource
    const sourceFix = knownSource === 'explore' ? {} : { discoverySource: source }
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

  return { isNew, metricInserted, hashtagsLinked, assetsSaved, authorTouched: authorId !== null }
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
    failures: 0,
  }

  for (const row of rows) {
    try {
      if (row.endpointKind === 'profile') {
        const profile = parseProfile(row.body)
        if (profile) await upsertAuthor(profile)
      } else if (!isExploreCapture(row)) {
        summary.skipped++
      } else {
        const medias = parseAllMedias(row.body, config.ENRICH_TARGET_WIDTH)
        summary.medias += medias.length

        for (const media of medias) {
          const result = await persistMedia(media, 'explore', row.capturedAt)
          if (result.isNew) summary.postsNew++
          else summary.postsUpdated++
          if (result.metricInserted) summary.metrics++
          summary.hashtags += result.hashtagsLinked
          summary.assets += result.assetsSaved
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

/** Reabre tudo para reprocessamento apos mudar o parser. */
export async function resetParsed(): Promise<number> {
  const rows = await db.update(rawResponse).set({ parsedAt: null }).returning({ id: rawResponse.id })
  return rows.length
}
