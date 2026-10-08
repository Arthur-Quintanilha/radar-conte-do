import { desc, eq, isNull, lt, or, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { author, collectionRun, post } from '../db/schema'
import { getPage, launchContext } from '../session/browser'
import { checkHealth } from '../session/health'
import { gotoWithRetry } from '../session/navigate'
import { attachInterceptor, type InterceptorHandle } from './interceptor'
import { RawStore } from './rawStore'
import { extractProfileFromHtml, profileFromGraphql, type ProfileFacts } from './profileExtract'
import { breakerStatus, recordSignal, recordSuccess } from './breaker'
import { sessionsToday } from '../shared/budget'
import { localDayKey } from '../shared/time'
import { assertNotStopped, StopRequested } from '../shared/stop'
import { humanPause } from '../shared/human'
import { config } from '../shared/config'
import { logger } from '../shared/logger'

export interface AuthorSyncOptions {
  limit?: number
  force?: boolean
}

export interface AuthorSyncSummary {
  runId: string | null
  status: 'ok' | 'aborted' | 'failed' | 'skipped'
  visited: number
  resolved: number
  bySource: Record<string, number>
  reason?: string
}

/**
 * Quem aparece mais no dataset vale mais: um autor com 5 posts rende 5 posts
 * normalizados. Por isso a fila e ordenada por numero de posts.
 */
export async function pendingAuthors(limit: number): Promise<{ id: string; username: string }[]> {
  const staleBefore = new Date(Date.now() - config.AUTHOR_STALE_DAYS * 86_400_000)

  return db
    .select({
      id: author.id,
      username: author.username,
      posts: sql<number>`count(${post.id})`,
    })
    .from(author)
    .leftJoin(post, eq(post.authorId, author.id))
    .where(or(isNull(author.followersCount), lt(author.lastSeenAt, staleBefore)))
    .groupBy(author.id)
    .orderBy(desc(sql`count(${post.id})`))
    .limit(limit)
}

export async function applyFacts(authorId: string, facts: ProfileFacts): Promise<void> {
  await db
    .update(author)
    .set({
      lastSeenAt: new Date(),
      ...(facts.followersCount !== undefined ? { followersCount: facts.followersCount } : {}),
      ...(facts.fullName !== undefined ? { fullName: facts.fullName } : {}),
      ...(facts.isVerified !== undefined ? { isVerified: facts.isVerified } : {}),
      ...(facts.biography !== undefined ? { biography: facts.biography } : {}),
      ...(facts.category !== undefined ? { category: facts.category } : {}),
    })
    .where(eq(author.id, authorId))
}

/**
 * Visita perfis para preencher follower_count, que nao vem em nenhum payload
 * do Explorar. Sem esse numero nao ha normalizacao de engajamento, e sem
 * normalizacao o ranking so premia conta grande.
 *
 * Roda separado da coleta, com orcamento diario proprio.
 */
export async function runAuthorSync(options: AuthorSyncOptions = {}): Promise<AuthorSyncSummary> {
  assertNotStopped()

  const empty: AuthorSyncSummary = {
    runId: null,
    status: 'skipped',
    visited: 0,
    resolved: 0,
    bySource: {},
  }

  const skip = (reason: string): AuthorSyncSummary => {
    logger.info({ motivo: reason }, 'sync de autores pulado')
    return { ...empty, reason }
  }

  const breaker = breakerStatus()
  if (breaker.open && !options.force) {
    return skip(`circuit breaker aberto ate ${breaker.until?.toISOString() ?? '?'}`)
  }

  // sem teto diario: o numero do .env so vira aviso. Quem protege a conta e o
  // circuit breaker acima, que para tudo quando o Instagram reclama
  const feitas = await sessionsToday('authors')
  if (feitas >= config.MAX_AUTHOR_SESSIONS_PER_DAY) {
    logger.warn(
      `esta e a execucao ${feitas + 1} de hoje (referencia: ${config.MAX_AUTHOR_SESSIONS_PER_DAY} por dia). Muitas visitas a perfis seguidas aumentam o risco de bloqueio.`,
    )
  }

  const limit = options.limit ?? config.MAX_AUTHORS_PER_SESSION
  const queue = await pendingAuthors(limit)
  if (queue.length === 0) {
    return skip('nenhum autor pendente — todos ja tem numero de seguidores')
  }

  const deadline = Date.now() + config.SESSION_MAX_MINUTES * 60_000

  const [runRow] = await db
    .insert(collectionRun)
    .values({ kind: 'authors', dayKey: localDayKey() })
    .returning({ id: collectionRun.id })

  if (!runRow) throw new Error('nao foi possivel criar o collection_run')
  const runId = runRow.id

  const store = new RawStore(runId)
  const bySource: Record<string, number> = {}
  let status: AuthorSyncSummary['status'] = 'ok'
  let abortReason: string | undefined
  let visited = 0
  let resolved = 0
  let rateLimited = false
  let handle: InterceptorHandle | null = null

  const context = await launchContext()

  try {
    const health = await checkHealth(context)
    if (health.status !== 'ok') {
      status = 'aborted'
      abortReason = `health: ${health.status}`
      if (health.status === 'challenge') await recordSignal('challenge', health.detail)
      throw new StopRequested()
    }

    const page = await getPage(context)

    // a pagina de perfil pede por graphql o `data.user` completo (seguidores
    // exatos, bio, categoria); o HTML so entra se isso nao vier
    let doGraphql: ProfileFacts | null = null
    let alvoAtual = ''
    handle = attachInterceptor(page, {
      onCapture: async (captured) => {
        await store.save(captured)
        const f = profileFromGraphql(captured.body, alvoAtual)
        if (f) doGraphql = f
      },
      onRateLimited: () => {
        rateLimited = true
      },
    })

    for (const candidate of queue) {
      assertNotStopped()
      if (rateLimited) {
        status = 'aborted'
        abortReason = 'rate limit durante o sync de autores'
        break
      }
      if (Date.now() > deadline) {
        abortReason = 'tempo maximo de sessao atingido'
        break
      }

      alvoAtual = candidate.username
      doGraphql = null
      const nav = await gotoWithRetry(page, `https://www.instagram.com/${candidate.username}/`, 2)
      visited++

      if (!nav.ok) {
        await recordSignal('nav_error', nav.error)
        continue
      }

      await humanPause(4_000, { min: 2_000, max: 12_000 })
      await handle.drain()

      const facts: ProfileFacts | null = doGraphql ?? extractProfileFromHtml(await page.content(), candidate.username)

      if (facts?.followersCount !== undefined) {
        await applyFacts(candidate.id, facts)
        resolved++
        bySource[facts.source] = (bySource[facts.source] ?? 0) + 1
        logger.info(
          { usuario: candidate.username, seguidores: facts.followersCount, origem: facts.source },
          'perfil resolvido',
        )
      } else {
        bySource['none'] = (bySource['none'] ?? 0) + 1
        logger.warn({ usuario: candidate.username }, 'nao achei o numero de seguidores nesta pagina')
      }

      await humanPause(12_000, { min: 6_000, max: 35_000 })
    }

    if (rateLimited) await recordSignal('rate_limited')
    else if (status === 'ok') recordSuccess()
  } catch (error) {
    if (error instanceof StopRequested) {
      status = 'aborted'
      abortReason = abortReason ?? 'STOP solicitado'
    } else {
      status = 'failed'
      abortReason = error instanceof Error ? error.message : String(error)
      logger.error({ err: error }, 'sync de autores falhou')
    }
  } finally {
    await handle?.drain()
    handle?.detach()
    await context.close().catch(() => undefined)

    await db
      .update(collectionRun)
      .set({
        endedAt: new Date(),
        status,
        postsOpened: visited,
        responsesCaptured: store.count,
        abortReason: abortReason ?? null,
      })
      .where(eq(collectionRun.id, runId))
  }

  const summary: AuthorSyncSummary = { runId, status, visited, resolved, bySource, reason: abortReason }
  logger.info(summary, 'sync de autores encerrado')
  return summary
}
