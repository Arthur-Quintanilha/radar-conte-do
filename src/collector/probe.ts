import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { eq } from 'drizzle-orm'
import type { Page, Response } from 'patchright'
import { db } from '../db/client'
import { collectionRun } from '../db/schema'
import { getPage, launchContext } from '../session/browser'
import { checkHealth } from '../session/health'
import { dismissInterstitials, gotoWithRetry } from '../session/navigate'
import { attachInterceptor, type InterceptorHandle } from './interceptor'
import { RawStore } from './rawStore'
import { searchUrl } from './searchUi'
import { extractItems } from './extract'
import { breakerStatus, recordSignal } from './breaker'
import { localDayKey } from '../shared/time'
import { assertNotStopped } from '../shared/stop'
import { humanPause, humanScroll, randInt } from '../shared/human'
import { config } from '../shared/config'
import { logger } from '../shared/logger'

export interface ProbeSummary {
  runId: string | null
  termo: string
  /** como chegou nos resultados (hoje sempre pela URL da busca) */
  metodo: 'url' | null
  urlFinal: string | null
  respostas: number
  porEndpoint: { endpoint: string; tipo: string; vezes: number; kb: number; midias: number }[]
  midias: number
  screenshot: string | null
  /** HTML da pagina de resultados (antes e depois de rolar) */
  html: string[]
  /** log de toda requisicao xhr/fetch/document que a pagina fez */
  rede: string | null
  requisicoes: number
  /** shortcodes achados no HTML por regex e nos blocos JSON embutidos */
  htmlShortcodes: number
  htmlBlocos: { blocos: number; comMidia: number; midias: number }
  erro?: string
}

/** Troca ids numericos e hashes do caminho por marcadores, para agrupar chamadas iguais. */
function endpointKey(url: string): string {
  try {
    return new URL(url).pathname.replace(/\/\d{3,}(?=\/|$)/g, '/:id').replace(/\/[0-9a-f]{24,}(?=\/|$)/gi, '/:hash')
  } catch {
    return url
  }
}

/** Guarda o HTML e conta o que da pra achar nele: shortcodes soltos e blocos JSON embutidos. */
async function salvarHtml(page: Page, arquivo: string): Promise<{ shortcodes: Set<string>; blocos: number; comMidia: number; midias: number }> {
  const html = await page.content()
  writeFileSync(arquivo, html, 'utf8')

  const shortcodes = new Set<string>()
  for (const m of html.matchAll(/"code":"([A-Za-z0-9_-]{8,20})"/g)) if (m[1]) shortcodes.add(m[1])

  let blocos = 0
  let comMidia = 0
  let midias = 0
  for (const m of html.matchAll(/<script type="application\/json"[^>]*>([\s\S]*?)<\/script>/g)) {
    blocos++
    try {
      const itens = extractItems(JSON.parse(m[1] ?? 'null'))
      if (itens.length) {
        comMidia++
        midias += itens.length
      }
    } catch {
      // bloco que nao e JSON valido: ignora
    }
  }
  return { shortcodes, blocos, comMidia, midias }
}

/**
 * Sondagem da busca do Instagram. Grava TODO JSON que a pagina de resultados
 * pedir, inclusive de endpoints que o coletor ainda nao conhece, e nao cria
 * nenhum post: o objetivo e ler o bruto antes de escrever o parser da busca.
 */
export async function runProbe(termo: string, scrolls = 3): Promise<ProbeSummary> {
  assertNotStopped()

  const vazio: ProbeSummary = { runId: null, termo, metodo: null, urlFinal: null, respostas: 0, porEndpoint: [], midias: 0, screenshot: null, html: [], rede: null, requisicoes: 0, htmlShortcodes: 0, htmlBlocos: { blocos: 0, comMidia: 0, midias: 0 } }

  const breaker = breakerStatus()
  if (breaker.open) {
    return { ...vazio, erro: `circuit breaker aberto ate ${breaker.until?.toISOString() ?? '?'}` }
  }

  const [run] = await db
    .insert(collectionRun)
    .values({ kind: 'probe', dayKey: localDayKey() })
    .returning({ id: collectionRun.id })
  if (!run) throw new Error('nao foi possivel criar o collection_run')

  const store = new RawStore(run.id)
  const stats = new Map<string, { endpoint: string; tipo: string; vezes: number; bytes: number; midias: number }>()
  const vistos = new Set<string>()
  let handle: InterceptorHandle | null = null
  let status = 'ok'
  let erro: string | undefined
  const summary: ProbeSummary = { ...vazio, runId: run.id }
  const dir = resolve(process.cwd(), config.RAW_DIR)
  const htmlCodes = new Set<string>()
  let logRede: ((response: Response) => void) | null = null
  let pagina: Page | null = null

  const context = await launchContext()
  try {
    const health = await checkHealth(context)
    if (health.status !== 'ok') {
      if (health.status === 'challenge') await recordSignal('challenge', health.detail)
      throw new Error(`health: ${health.status}`)
    }

    const page = await getPage(context)
    pagina = page
    handle = attachInterceptor(page, {
      captureAll: true,
      onCapture: async (captured) => {
        await store.save(captured)
        const itens = extractItems(captured.body)
        itens.forEach((i) => vistos.add(i.shortcode))

        const key = `${captured.kind} ${endpointKey(captured.url)}`
        const s = stats.get(key) ?? { endpoint: endpointKey(captured.url), tipo: captured.kind, vezes: 0, bytes: 0, midias: 0 }
        s.vezes++
        s.bytes += JSON.stringify(captured.body).length
        s.midias += itens.length
        stats.set(key, s)
      },
      onRateLimited: () => recordSignal('rate_limited'),
    })

    mkdirSync(dir, { recursive: true })
    summary.rede = join(dir, `${run.id}-sonda-rede.jsonl`)
    const arquivoRede = summary.rede
    logRede = (response: Response) => {
      const req = response.request()
      const tipo = req.resourceType()
      if (tipo !== 'xhr' && tipo !== 'fetch' && tipo !== 'document') return
      const url = response.url()
      if (!/instagram\.com|facebook\.com/.test(url)) return
      const post = req.postData() ?? ''
      const nome = req.headers()['x-fb-friendly-name'] ?? /fb_api_req_friendly_name=([^&]+)/.exec(post)?.[1] ?? null
      const docId = /(?:^|&)doc_id=(\d+)/.exec(post)?.[1] ?? null
      let caminho = url
      try {
        const u = new URL(url)
        caminho = u.host + u.pathname + (u.search.length > 160 ? u.search.slice(0, 160) + '...' : u.search)
      } catch {
        // mantem a url crua
      }
      summary.requisicoes++
      appendFileSync(
        arquivoRede,
        JSON.stringify({
          t: new Date().toISOString(),
          pagina: page.url(),
          tipo,
          metodo: req.method(),
          status: response.status(),
          ct: response.headers()['content-type'] ?? null,
          bytes: Number(response.headers()['content-length'] ?? 0) || null,
          nome: nome ? decodeURIComponent(nome) : null,
          docId,
          url: caminho,
        }) + '\n',
      )
    }
    page.on('response', logRede)

    const nav = await gotoWithRetry(page, 'https://www.instagram.com/explore/')
    if (!nav.ok) throw new Error(`nao abriu o explorar: ${nav.error ?? '?'}`)
    await humanPause(3_000, { min: 1_800, max: 7_000 })
    await dismissInterstitials(page, 'https://www.instagram.com/explore/')

    summary.metodo = 'url'
    const direto = await gotoWithRetry(page, searchUrl(termo))
    if (!direto.ok) throw new Error(`nao abriu os resultados: ${direto.error ?? '?'}`)
    await humanPause(3_500, { min: 2_000, max: 8_000 })
    await dismissInterstitials(page, searchUrl(termo))

    const antes = join(dir, `${run.id}-sonda-antes.html`)
    const a = await salvarHtml(page, antes)
    summary.html.push(antes)
    a.shortcodes.forEach((c) => htmlCodes.add(c))
    logger.info({ shortcodes: a.shortcodes.size, blocos: a.blocos, comMidia: a.comMidia }, 'html dos resultados salvo')

    for (let i = 0; i < scrolls; i++) {
      assertNotStopped()
      await humanScroll(page, randInt(700, 1_300))
      await humanPause(4_000, { min: 2_000, max: 9_000 })
      await handle.drain()
      logger.info({ scroll: i + 1, respostas: store.count, posts: vistos.size }, 'rolando resultados')
    }

    summary.urlFinal = page.url()
    const depois = join(dir, `${run.id}-sonda-depois.html`)
    const d = await salvarHtml(page, depois)
    summary.html.push(depois)
    d.shortcodes.forEach((c) => htmlCodes.add(c))
    summary.htmlBlocos = { blocos: d.blocos, comMidia: d.comMidia, midias: d.midias }

    summary.screenshot = join(dir, `${run.id}-sonda.png`)
    await page.screenshot({ path: summary.screenshot }).catch(() => {
      summary.screenshot = null
    })
  } catch (error) {
    status = 'failed'
    erro = error instanceof Error ? error.message : String(error)
    logger.error({ erro }, 'sondagem falhou')
  } finally {
    await handle?.drain()
    handle?.detach()
    if (pagina && logRede) pagina.off('response', logRede)
    await context.close().catch(() => undefined)
    await db
      .update(collectionRun)
      .set({ endedAt: new Date(), status, cardsSeen: vistos.size, responsesCaptured: store.count, abortReason: erro ?? null })
      .where(eq(collectionRun.id, run.id))
  }

  summary.respostas = store.count
  summary.midias = vistos.size
  summary.htmlShortcodes = htmlCodes.size
  summary.porEndpoint = [...stats.values()]
    .map((s) => ({ endpoint: s.endpoint, tipo: s.tipo, vezes: s.vezes, kb: Math.round(s.bytes / 1024), midias: s.midias }))
    .sort((a, b) => b.midias - a.midias || b.kb - a.kb)
  if (erro) summary.erro = erro
  return summary
}
