import { eq, inArray } from 'drizzle-orm'
import { db } from '../db/client'
import { collectionRun, post } from '../db/schema'
import { getPage, launchContext } from '../session/browser'
import { checkHealth } from '../session/health'
import { dismissInterstitials, gotoWithRetry } from '../session/navigate'
import { attachInterceptor, type InterceptorHandle } from './interceptor'
import { RawStore } from './rawStore'
import { extractItems, type DiscoveredItem } from './extract'
import { isExploreCapture } from '../parser/run'
import { breakerStatus, recordSignal, recordSuccess, type Signal } from './breaker'
import { checkBudget } from '../shared/budget'
import { localDayKey } from '../shared/time'
import { assertNotStopped, StopRequested } from '../shared/stop'
import { humanPause, humanScroll, randInt } from '../shared/human'
import { config } from '../shared/config'
import { logger } from '../shared/logger'
import { notify } from '../shared/notify'

export interface CollectOptions {
  maxScrolls?: number
  force?: boolean
}

export interface RunSummary {
  runId: string | null
  status: 'ok' | 'aborted' | 'failed' | 'skipped'
  cardsSeen: number
  cardsNew: number
  responses: number
  reason?: string
}

const HEALTH_SIGNALS: Record<string, Signal> = {
  challenge: 'challenge',
  logged_out: 'logged_out',
  rate_limited: 'rate_limited',
  soft_block: 'empty_feed',
}

/** Insere os shortcodes novos e atualiza last_seen_at dos ja conhecidos. */
async function persistDiscovered(items: DiscoveredItem[]): Promise<number> {
  if (items.length === 0) return 0

  let newCount = 0
  const chunkSize = 200

  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize)

    const inserted = await db
      .insert(post)
      .values(
        chunk.map((item) => ({
          shortcode: item.shortcode,
          igMediaId: item.mediaId ?? null,
          mediaType: item.mediaType ?? null,
          // o parser corrige pela origem real do payload
          discoverySource: 'unknown',
        })),
      )
      .onConflictDoNothing({ target: post.shortcode })
      .returning({ id: post.id })

    newCount += inserted.length

    await db
      .update(post)
      .set({ lastSeenAt: new Date() })
      .where(
        inArray(
          post.shortcode,
          chunk.map((item) => item.shortcode),
        ),
      )
  }

  return newCount
}

export async function runCollection(options: CollectOptions = {}): Promise<RunSummary> {
  assertNotStopped()

  const breaker = breakerStatus()
  if (breaker.open && !options.force) {
    const reason = `circuit breaker aberto ate ${breaker.until?.toISOString() ?? '?'}`
    logger.warn(reason)
    return { runId: null, status: 'skipped', cardsSeen: 0, cardsNew: 0, responses: 0, reason }
  }

  if (!options.force) {
    const budget = await checkBudget()
    if (!budget.allowed) {
      logger.info({ reason: budget.reason }, 'coleta pulada pelo orcamento')
      return {
        runId: null,
        status: 'skipped',
        cardsSeen: 0,
        cardsNew: 0,
        responses: 0,
        reason: budget.reason,
      }
    }
  }

  const maxScrolls = options.maxScrolls ?? config.MAX_SCROLLS
  const deadline = Date.now() + config.SESSION_MAX_MINUTES * 60_000

  const [runRow] = await db
    .insert(collectionRun)
    .values({ kind: 'explore', dayKey: localDayKey() })
    .returning({ id: collectionRun.id })

  if (!runRow) throw new Error('nao foi possivel criar o collection_run')
  const runId = runRow.id

  const store = new RawStore(runId)
  const discovered = new Map<string, DiscoveredItem>()

  let status: RunSummary['status'] = 'ok'
  let abortReason: string | undefined
  let cardsNew = 0
  let rateLimited = false
  let handle: InterceptorHandle | null = null

  const context = await launchContext()

  try {
    const health = await checkHealth(context)
    if (health.status !== 'ok') {
      status = 'aborted'
      abortReason = `health: ${health.status}${health.detail ? ` (${health.detail})` : ''}`
      const signal = HEALTH_SIGNALS[health.status]
      if (signal) await recordSignal(signal, health.detail)
      await notify(`Coleta abortada. ${abortReason}`)
      throw new StopRequested()
    }

    const page = await getPage(context)

    handle = attachInterceptor(page, {
      onCapture: async (captured) => {
        await store.save(captured)

        // o bruto guarda tudo, mas so o Explorar vira post: abrir um post ou
        // passar pelo feed dispara os mesmos endpoints com outro conteudo
        if (!isExploreCapture({ endpointKind: captured.kind, pageUrl: captured.pageUrl })) return

        for (const item of extractItems(captured.body)) {
          if (!discovered.has(item.shortcode)) discovered.set(item.shortcode, item)
        }
      },
      onRateLimited: async () => {
        rateLimited = true
        logger.warn('429 recebido durante a coleta')
      },
    })

    const nav = await gotoWithRetry(page, 'https://www.instagram.com/explore/')
    if (!nav.ok) {
      status = 'aborted'
      abortReason = `nao consegui abrir o explorar: ${nav.error ?? '?'}`
      await recordSignal('nav_error', nav.error)
      throw new StopRequested()
    }
    await humanPause(3_500, { min: 2_000, max: 9_000 })
    await dismissInterstitials(page, 'https://www.instagram.com/explore/')

    let emptyStreak = 0

    for (let i = 0; i < maxScrolls; i++) {
      assertNotStopped()
      if (rateLimited) {
        status = 'aborted'
        abortReason = 'rate limit durante o scroll'
        break
      }
      if (Date.now() > deadline) {
        abortReason = 'tempo maximo de sessao atingido'
        break
      }

      const before = discovered.size
      await humanScroll(page, randInt(700, 1_400))
      await humanPause(4_000, { min: 2_000, max: 11_000 })
      await handle.drain()

      const added = discovered.size - before
      logger.info({ scroll: i + 1, added, total: discovered.size }, 'scroll do explorar')

      if (added > 0) {
        emptyStreak = 0
        continue
      }

      // antes do primeiro card, scroll vazio significa pagina ainda carregando,
      // nao fim do Explorar — contar isso aborta a sessao em segundos
      if (discovered.size === 0) {
        if (i >= 4) {
          abortReason = 'o explorar nao carregou nenhum item'
          await recordSignal('empty_feed')
          break
        }
        continue
      }

      emptyStreak += 1
      if (emptyStreak >= 3) {
        abortReason = 'explorar parou de trazer itens novos'
        break
      }
    }

    cardsNew = await persistDiscovered([...discovered.values()])

    if (rateLimited) await recordSignal('rate_limited')
    else if (discovered.size === 0) await recordSignal('empty_feed')
    else if (status === 'ok') recordSuccess()
  } catch (error) {
    if (error instanceof StopRequested) {
      status = 'aborted'
      abortReason = abortReason ?? 'STOP solicitado'
      logger.warn({ abortReason }, 'coleta abortada')
    } else {
      status = 'failed'
      abortReason = error instanceof Error ? error.message : String(error)
      logger.error({ err: error }, 'coleta falhou')
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
        cardsSeen: discovered.size,
        cardsNew,
        responsesCaptured: store.count,
        parseFailures: handle?.readFailures ?? 0,
        abortReason: abortReason ?? null,
      })
      .where(eq(collectionRun.id, runId))
  }

  const summary: RunSummary = {
    runId,
    status,
    cardsSeen: discovered.size,
    cardsNew,
    responses: store.count,
    reason: abortReason,
  }

  logger.info(summary, 'run encerrado')
  return summary
}
