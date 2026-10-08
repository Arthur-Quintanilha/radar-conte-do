import { eq } from 'drizzle-orm'
import { db } from '../db/client'
import { collectionRun } from '../db/schema'
import { getPage, launchContext } from '../session/browser'
import { checkHealth } from '../session/health'
import { dismissInterstitials, gotoWithRetry } from '../session/navigate'
import { attachInterceptor, type InterceptorHandle } from './interceptor'
import { RawStore } from './rawStore'
import { searchUrl } from './searchUi'
import { loadTerms, normalizeTerm, pickNext, termStatus } from './terms'
import { isSearchCapture, parsePending, type ParseSummary } from '../parser/run'
import { downloadPending, type DownloadSummary } from '../enricher/download'
import { parseSearchPage } from '../parser/search'
import { breakerStatus, recordSignal, recordSuccess, type Signal } from './breaker'
import { sessionsToday } from '../shared/budget'
import { localDayKey } from '../shared/time'
import { assertNotStopped, StopRequested } from '../shared/stop'
import { humanPause, humanScroll, randInt } from '../shared/human'
import { config } from '../shared/config'
import { logger } from '../shared/logger'
import { notify } from '../shared/notify'

export interface SearchOptions {
  /** sem termo, pega o proximo da fila de termos.txt */
  termo?: string
  scrolls?: number
  force?: boolean
}

export interface SearchSummary {
  runId: string | null
  termo: string | null
  status: 'ok' | 'aborted' | 'failed' | 'skipped'
  metodo: 'url' | null
  posts: number
  paginas: number
  responses: number
  /** o parse roda sozinho no fim: as URLs do CDN expiram em poucas horas */
  parse?: ParseSummary
  /** capas, slides e videos baixados logo em seguida, antes das URLs expirarem */
  media?: DownloadSummary
  /** passou do numero de buscas por dia configurado: so avisa, nao bloqueia */
  aviso?: string
  reason?: string
}

const HEALTH_SIGNALS: Record<string, Signal> = {
  challenge: 'challenge',
  logged_out: 'logged_out',
  rate_limited: 'rate_limited',
  soft_block: 'empty_feed',
}

/**
 * Pesquisa um termo como uma pessoa faria e rola os resultados.
 *
 * So grava o bruto: quem transforma em post e aparicao e o `parse`. Nunca
 * abre post nem perfil.
 */
export async function runSearch(options: SearchOptions = {}): Promise<SearchSummary> {
  assertNotStopped()
  const skipped = (reason: string, termo: string | null = null): SearchSummary => {
    logger.info({ reason }, 'busca pulada')
    return { runId: null, termo, status: 'skipped', metodo: null, posts: 0, paginas: 0, responses: 0, reason }
  }

  let termo = options.termo ? normalizeTerm(options.termo) : null
  if (!termo) {
    const termos = loadTerms()
    if (termos.length === 0) return skipped(`nenhum termo em ${config.SEARCH_TERMS_FILE}`)
    termo = pickNext(await termStatus(termos))
    if (!termo) return skipped('fila de termos vazia')
  }

  const breaker = breakerStatus()
  if (breaker.open && !options.force) {
    return skipped(`circuit breaker aberto ate ${breaker.until?.toISOString() ?? '?'}`, termo)
  }
  // sem teto: o limite do .env so vira aviso. O que protege a conta de verdade
  // e o circuit breaker acima, que para tudo quando o Instagram reclama
  const feitas = await sessionsToday('search')
  const aviso =
    feitas >= config.MAX_SEARCH_SESSIONS_PER_DAY
      ? `esta e a busca ${feitas + 1} de hoje (referencia: ${config.MAX_SEARCH_SESSIONS_PER_DAY} por dia). Muitas buscas seguidas aumentam o risco de bloqueio.`
      : undefined
  if (aviso) logger.warn(aviso)

  const scrolls = options.scrolls ?? config.SEARCH_SCROLLS
  const deadline = Date.now() + config.SESSION_MAX_MINUTES * 60_000

  const [run] = await db
    .insert(collectionRun)
    .values({ kind: 'search', term: termo, dayKey: localDayKey() })
    .returning({ id: collectionRun.id })
  if (!run) throw new Error('nao foi possivel criar o collection_run')

  const store = new RawStore(run.id)
  const vistos = new Set<string>()
  let paginas = 0
  let temMais = true
  let rateLimited = false
  let status: SearchSummary['status'] = 'ok'
  let metodo: SearchSummary['metodo'] = null
  let abortReason: string | undefined
  let handle: InterceptorHandle | null = null

  const context = await launchContext()
  try {
    const health = await checkHealth(context)
    if (health.status !== 'ok') {
      status = 'aborted'
      abortReason = `health: ${health.status}${health.detail ? ` (${health.detail})` : ''}`
      const signal = HEALTH_SIGNALS[health.status]
      if (signal) await recordSignal(signal, health.detail)
      await notify(`Busca abortada. ${abortReason}`)
      throw new StopRequested()
    }

    const page = await getPage(context)
    handle = attachInterceptor(page, {
      onCapture: async (captured) => {
        await store.save(captured)
        if (!isSearchCapture({ endpointKind: captured.kind, pageUrl: captured.pageUrl })) return
        const resultado = parseSearchPage(captured.body)
        if (!resultado) return
        paginas++
        temMais = resultado.hasNextPage
        resultado.medias.forEach((m) => vistos.add(m.shortcode))
      },
      onRateLimited: () => {
        rateLimited = true
        logger.warn('429 recebido durante a busca')
      },
    })

    const nav = await gotoWithRetry(page, 'https://www.instagram.com/explore/')
    if (!nav.ok) {
      status = 'aborted'
      abortReason = `nao consegui abrir o explorar: ${nav.error ?? '?'}`
      await recordSignal('nav_error', nav.error)
      throw new StopRequested()
    }
    await humanPause(3_000, { min: 1_800, max: 7_000 })
    await dismissInterstitials(page, 'https://www.instagram.com/explore/')

    // passa pelo Explorar antes, como quem abre o app e depois pesquisa
    metodo = 'url'
    const direto = await gotoWithRetry(page, searchUrl(termo))
    if (!direto.ok) {
      status = 'aborted'
      abortReason = `nao abriu os resultados: ${direto.error ?? '?'}`
      await recordSignal('nav_error', direto.error)
      throw new StopRequested()
    }
    await humanPause(3_500, { min: 2_000, max: 8_000 })
    await dismissInterstitials(page, searchUrl(termo))
    await handle.drain()

    let semNovos = 0
    for (let i = 0; i < scrolls; i++) {
      assertNotStopped()
      if (rateLimited) {
        status = 'aborted'
        abortReason = 'rate limit durante a busca'
        break
      }
      if (Date.now() > deadline) {
        abortReason = 'tempo maximo de sessao atingido'
        break
      }
      if (paginas > 0 && !temMais) {
        logger.info('fim dos resultados')
        break
      }

      const antes = vistos.size
      await humanScroll(page, randInt(800, 1_500))
      await humanPause(4_000, { min: 2_000, max: 10_000 })
      await handle.drain()
      logger.info({ termo, scroll: i + 1, novos: vistos.size - antes, total: vistos.size }, 'rolando resultados')

      semNovos = vistos.size > antes ? 0 : semNovos + 1
      if (semNovos >= 3) {
        abortReason = 'resultados pararam de carregar'
        break
      }
    }

    if (rateLimited) await recordSignal('rate_limited')
    else if (vistos.size === 0) {
      if (paginas > 0) {
        // o Instagram respondeu a busca, so que sem posts: o termo conta como
        // pesquisado e a fila anda. Sem pagina nenhuma, a busca nao carregou e
        // o termo fica para a proxima
        abortReason = abortReason ?? 'o Instagram nao tem posts para este termo'
      } else {
        status = 'aborted'
        abortReason = abortReason ?? 'a pagina de resultados nao carregou'
      }
    } else if (status === 'ok') recordSuccess()
  } catch (error) {
    if (error instanceof StopRequested) {
      status = 'aborted'
      abortReason = abortReason ?? 'STOP solicitado'
    } else {
      status = 'failed'
      abortReason = error instanceof Error ? error.message : String(error)
      logger.error({ err: error }, 'busca falhou')
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
        cardsSeen: vistos.size,
        responsesCaptured: store.count,
        parseFailures: handle?.readFailures ?? 0,
        abortReason: abortReason ?? null,
      })
      .where(eq(collectionRun.id, run.id))
  }

  const summary: SearchSummary = {
    runId: run.id,
    termo,
    status,
    metodo,
    posts: vistos.size,
    paginas,
    responses: store.count,
    aviso,
    reason: abortReason,
  }
  if (vistos.size > 0) {
    summary.parse = await parsePending(2_000)
    logger.info('baixando capas e videos (as URLs do Instagram expiram em poucas horas)')
    summary.media = await downloadPending()
  }
  logger.info({ ...summary, parse: undefined, media: undefined }, 'busca encerrada')
  return summary
}
