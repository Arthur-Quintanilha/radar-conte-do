import { servidor } from '../servidor'
import type { ContaFila, ResumoParse } from '../../comum/porta'
import { getPage, launchContext } from '../session/browser'
import { checkHealth } from '../session/health'
import { dismissInterstitials, gotoWithRetry } from '../session/navigate'
import { attachInterceptor, type InterceptorHandle } from './interceptor'
import { RawStore } from './rawStore'
import { extractItems } from '../../comum/parser/extract'
import { extractProfileFromHtml, profileFromGraphql, type ProfileFacts } from '../../comum/parser/profileExtract'
import { breakerStatus, recordSignal, recordSuccess } from './breaker'
import { downloadPending, type DownloadSummary } from '../midia/download'
import { assertNotStopped, StopRequested } from '../../comum/stop'
import { humanPause, humanScroll, randInt } from '../../comum/human'
import { config } from '../../comum/config'
import { logger } from '../../comum/logger'

export interface WatchOptions {
  /** visita so esta conta, esteja ou nao na lista */
  username?: string
  limite?: number
  force?: boolean
  /**
   * so estas contas (minusculas). A fila "acompanhar" e global entre as
   * personas; o ciclo passa as contas da persona ativa para nao visitar as
   * de outra.
   */
  permitidos?: string[]
}

export interface WatchSummary {
  runId: string | null
  status: 'ok' | 'aborted' | 'failed' | 'skipped'
  visitados: string[]
  /** posts do dono do perfil encontrados na pagina */
  posts: number
  parse?: ResumoParse
  media?: DownloadSummary
  reason?: string
}

/** Blocos <script type="application/json"> do HTML que trazem posts. */
function blocosComPosts(html: string): unknown[] {
  const blocos: unknown[] = []
  for (const m of html.matchAll(/<script type="application\/json"[^>]*>([\s\S]*?)<\/script>/g)) {
    const texto = m[1]
    if (!texto || !texto.includes('"code"')) continue
    try {
      const json: unknown = JSON.parse(texto)
      if (extractItems(json).length > 0) blocos.push(json)
    } catch {
      // bloco que nao e JSON valido
    }
  }
  return blocos
}

/**
 * Visita o perfil de quem voce marcou para acompanhar e grava os posts que
 * estao la. O perfil vem pronto do servidor (posts embutidos no HTML); ao
 * rolar, os seguintes chegam por graphql. Os dois caminhos sao gravados no
 * bruto, e o parser so aproveita os posts do proprio dono do perfil.
 */
export async function runWatch(options: WatchOptions = {}): Promise<WatchSummary> {
  assertNotStopped()
  const vazio: WatchSummary = { runId: null, status: 'skipped', visitados: [], posts: 0 }

  const breaker = breakerStatus()
  if (breaker.open && !options.force) {
    return { ...vazio, reason: `circuit breaker aberto ate ${breaker.until?.toISOString() ?? '?'}` }
  }

  const srv = servidor()
  let fila: ContaFila[]
  if (options.username) {
    const u = options.username.replace(/^@/, '').trim().toLowerCase()
    const conta = await srv.contaPorUsername(u)
    if (!conta) return { ...vazio, reason: `@${u} nao esta no banco` }
    fila = [conta]
  } else {
    fila = options.permitidos && options.permitidos.length === 0 ? [] : await srv.filaAcompanhar(options.limite ?? config.WATCH_PER_SESSION, options.permitidos)
  }
  if (fila.length === 0) {
    return {
      ...vazio,
      reason: `ninguem para visitar: marque contas como "acompanhar" no painel (aba Autores) ou todas foram visitadas nas ultimas ${config.WATCH_MIN_HOURS}h`,
    }
  }

  const runId = await srv.abrirColeta('watch')
  const store = new RawStore(runId)
  const deadline = Date.now() + config.SESSION_MAX_MINUTES * 60_000
  const visitados: string[] = []
  let posts = 0
  let status: WatchSummary['status'] = 'ok'
  let abortReason: string | undefined
  let rateLimited = false
  let handle: InterceptorHandle | null = null

  const context = await launchContext()
  try {
    const health = await checkHealth(context)
    if (health.status !== 'ok') {
      status = 'aborted'
      abortReason = `health: ${health.status}`
      if (health.status === 'challenge') await recordSignal('challenge', health.detail)
      if (health.status === 'logged_out') await recordSignal('logged_out', health.detail)
      throw new StopRequested()
    }

    const page = await getPage(context)
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

    for (const alvo of fila) {
      assertNotStopped()
      if (rateLimited) {
        status = 'aborted'
        abortReason = 'rate limit durante as visitas'
        break
      }
      if (Date.now() > deadline) {
        abortReason = 'tempo maximo de sessao atingido'
        break
      }

      const url = `https://www.instagram.com/${alvo.username}/`
      alvoAtual = alvo.username
      doGraphql = null
      const nav = await gotoWithRetry(page, url, 2)
      if (!nav.ok) {
        await recordSignal('nav_error', nav.error)
        continue
      }
      await humanPause(3_500, { min: 2_000, max: 9_000 })
      await dismissInterstitials(page, url)

      const html = await page.content()
      const blocos = blocosComPosts(html)
      await store.save({
        url: page.url(),
        pageUrl: page.url(),
        kind: 'html',
        status: 200,
        body: { fonte: 'html', perfil: alvo.username, blocos },
        capturedAt: new Date(),
      })

      await handle.drain()
      const facts = doGraphql ?? extractProfileFromHtml(html, alvo.username)
      if (facts) await srv.aplicarPerfil(alvo.id, facts)

      // rola um pouco, como quem passa o olho no perfil
      const rolagens = randInt(1, 3)
      for (let i = 0; i < rolagens; i++) {
        await humanScroll(page, randInt(600, 1_200))
        await humanPause(3_000, { min: 1_500, max: 8_000 })
      }
      await handle.drain()

      const achados = blocos.reduce<number>((n, b) => n + extractItems(b).length, 0)
      posts += achados
      visitados.push(alvo.username)
      await srv.marcarVisitada(alvo.id)
      logger.info({ perfil: alvo.username, postsNaPagina: achados }, 'perfil visitado')

      await humanPause(10_000, { min: 5_000, max: 30_000 })
    }

    if (rateLimited) await recordSignal('rate_limited')
    else if (status === 'ok' && visitados.length > 0) recordSuccess()
  } catch (error) {
    if (error instanceof StopRequested) {
      status = 'aborted'
      abortReason = abortReason ?? 'STOP solicitado'
    } else {
      status = 'failed'
      abortReason = error instanceof Error ? error.message : String(error)
      logger.error({ err: error }, 'visita a perfis falhou')
    }
  } finally {
    await handle?.drain()
    handle?.detach()
    await context.close().catch(() => undefined)
    await srv.fecharColeta(runId, { status, cardsSeen: posts, postsOpened: visitados.length, responsesCaptured: store.count, abortReason: abortReason ?? null })
  }

  const summary: WatchSummary = { runId, status, visitados, posts, reason: abortReason }
  if (visitados.length > 0) {
    summary.parse = await srv.processarCapturas()
    logger.info('baixando capas e videos (as URLs do Instagram expiram em poucas horas)')
    summary.media = await downloadPending()
  }
  logger.info({ ...summary, parse: undefined, media: undefined }, 'visitas encerradas')
  return summary
}
