import { and, eq, inArray, isNull, lt, notInArray, sql } from 'drizzle-orm'
import { db } from '../db/client'
import {
  author,
  hashtag,
  collectionRun,
  discovery,
  enrichment,
  mediaAsset,
  post,
  postEmbedding,
  postHashtag,
  postMetric,
} from '../db/schema'
import { rawResponse } from '../db/schema'
import { isExploreCapture, isSearchCapture, isWatchCapture, ownPosts, watchRunIds } from '../parser/run'
import { parseSearchPage } from '../../comum/parser/search'
import { parseAllMedias } from '../../comum/parser/media'
import { logger } from '../../comum/logger'

export interface PurgeSummary {
  posts: number
  /** posts sem nenhuma captura do Explorar por tras — sobra de versoes antigas */
  orphanPosts: number
  metrics: number
  hashtagLinks: number
  assets: number
  enrichments: number
  embeddings: number
  orphanAuthors: number
  orphanHashtags: number
  staleRuns: number
}

/**
 * Remove tudo que nao veio do Explorar, da busca por palavra ou da visita a
 * um perfil que voce marcou para acompanhar. Feed da home nunca entra.
 *
 * O payload bruto continua guardado, entao isto e reversivel: se a regra
 * mudar, basta reprocessar com `parse --reset`.
 */
export async function purgeNonExplore(): Promise<PurgeSummary> {
  const doomed = await db
    .select({ id: post.id })
    .from(post)
    .where(notInArray(post.discoverySource, ['explore', 'search', 'profile']))
  const ids = doomed.map((row) => row.id)

  const summary: PurgeSummary = {
    posts: 0,
    orphanPosts: 0,
    metrics: 0,
    hashtagLinks: 0,
    assets: 0,
    enrichments: 0,
    embeddings: 0,
    orphanAuthors: 0,
    orphanHashtags: 0,
    staleRuns: 0,
  }

  // em lotes: SQLite limita o numero de parametros por consulta
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200)

    await db.delete(discovery).where(inArray(discovery.postId, chunk))
    summary.metrics += (
      await db.delete(postMetric).where(inArray(postMetric.postId, chunk)).returning({ id: postMetric.id })
    ).length
    summary.hashtagLinks += (
      await db.delete(postHashtag).where(inArray(postHashtag.postId, chunk)).returning({ id: postHashtag.postId })
    ).length
    summary.assets += (
      await db.delete(mediaAsset).where(inArray(mediaAsset.postId, chunk)).returning({ id: mediaAsset.id })
    ).length
    summary.enrichments += (
      await db.delete(enrichment).where(inArray(enrichment.postId, chunk)).returning({ id: enrichment.id })
    ).length
    summary.embeddings += (
      await db.delete(postEmbedding).where(inArray(postEmbedding.postId, chunk)).returning({ id: postEmbedding.postId })
    ).length
    summary.posts += (await db.delete(post).where(inArray(post.id, chunk)).returning({ id: post.id })).length
  }

  // posts que nao aparecem em nenhuma captura do Explorar ou da busca: sobra de
  // versoes antigas do coletor, inclusive o feed da home que vinha junto
  summary.orphanPosts = await dropOrphanPosts()

  // autores que ficaram sem nenhum post
  const withPosts = await db.selectDistinct({ id: post.authorId }).from(post)
  const keep = withPosts.map((row) => row.id).filter((id): id is string => id !== null)

  const orphans = await db
    .delete(author)
    // conta que voce marcou (acompanhar/ignorar) fica, mesmo sem post ainda
    .where(and(keep.length > 0 ? notInArray(author.id, keep) : sql`1 = 1`, isNull(author.watch)))
    .returning({ id: author.id })
  summary.orphanAuthors = orphans.length

  // hashtags que nao apontam mais para nenhum post
  const usadas = await db.selectDistinct({ id: postHashtag.hashtagId }).from(postHashtag)
  const manter = usadas.map((row) => row.id)
  summary.orphanHashtags = (
    await db
      .delete(hashtag)
      .where(manter.length > 0 ? notInArray(hashtag.id, manter) : sql`1 = 1`)
      .returning({ id: hashtag.id })
  ).length

  summary.staleRuns = await closeStaleRuns()

  logger.info(summary, 'limpeza concluida')
  return summary
}

/**
 * Reconstroi, a partir do bruto, o conjunto de shortcodes que realmente
 * apareceram no Explorar, e remove os posts que nao estao nele.
 *
 * Nao faz nada se nao houver nenhuma captura do Explorar guardada — nesse
 * caso o bruto e que esta incompleto, e apagar tudo seria pior.
 */
async function dropOrphanPosts(): Promise<number> {
  const rows = await db
    .select({ endpointKind: rawResponse.endpointKind, pageUrl: rawResponse.pageUrl, runId: rawResponse.runId, body: rawResponse.body })
    .from(rawResponse)

  const watchRuns = await watchRunIds()
  const visto = new Set<string>()
  for (const row of rows) {
    if (isExploreCapture(row)) {
      for (const media of parseAllMedias(row.body)) visto.add(media.shortcode)
    } else if (isSearchCapture(row)) {
      for (const media of parseSearchPage(row.body)?.medias ?? []) visto.add(media.shortcode)
    } else {
      const dono = isWatchCapture(row, watchRuns)
      if (dono) for (const media of ownPosts(parseAllMedias(row.body), dono, row.endpointKind === 'html')) visto.add(media.shortcode)
    }
  }

  if (visto.size === 0) {
    logger.warn('nenhuma captura do Explorar ou da busca no bruto; posts orfaos nao foram tocados')
    return 0
  }

  const todos = await db.select({ id: post.id, shortcode: post.shortcode }).from(post)
  const orfaos = todos.filter((p) => !visto.has(p.shortcode)).map((p) => p.id)
  if (orfaos.length === 0) return 0

  let removed = 0
  for (let i = 0; i < orfaos.length; i += 200) {
    const chunk = orfaos.slice(i, i + 200)
    await db.delete(discovery).where(inArray(discovery.postId, chunk))
    await db.delete(postMetric).where(inArray(postMetric.postId, chunk))
    await db.delete(postHashtag).where(inArray(postHashtag.postId, chunk))
    await db.delete(mediaAsset).where(inArray(mediaAsset.postId, chunk))
    await db.delete(enrichment).where(inArray(enrichment.postId, chunk))
    await db.delete(postEmbedding).where(inArray(postEmbedding.postId, chunk))
    removed += (await db.delete(post).where(inArray(post.id, chunk)).returning({ id: post.id })).length
  }
  return removed
}

/**
 * Sessoes interrompidas (Ctrl+C) ficam com status `running` para sempre e
 * continuam contando no teto diario. Fecha as que ja passaram do prazo.
 */
export async function closeStaleRuns(maxMinutes = 60): Promise<number> {
  const cutoff = new Date(Date.now() - maxMinutes * 60_000)
  const closed = await db
    .update(collectionRun)
    .set({ status: 'aborted', endedAt: new Date(), abortReason: 'interrompida — fechada na limpeza' })
    .where(
      and(eq(collectionRun.status, 'running'), isNull(collectionRun.endedAt), lt(collectionRun.startedAt, cutoff)),
    )
    .returning({ id: collectionRun.id })
  return closed.length
}
