import { and, asc, eq, isNull, lt, or, sql } from 'drizzle-orm'
import type { Page } from 'patchright'
import { db } from '../db/client'
import { collectionRun, persona, semente } from '../db/schema'
import { getPage, launchContext } from '../session/browser'
import { checkHealth } from '../session/health'
import { dismissInterstitials, gotoWithRetry } from '../session/navigate'
import { attachInterceptor, type InterceptorHandle } from './interceptor'
import { RawStore } from './rawStore'
import { extractProfileFromHtml, profileFromGraphql } from './profileExtract'
import { breakerStatus, recordSignal, recordSuccess } from './breaker'
import { extractFollowing, sementeDaPagina } from '../parser/following'
import { parsePending, type ParseSummary } from '../parser/run'
import { checkBudget } from '../shared/budget'
import { localDayKey } from '../shared/time'
import { assertNotStopped, StopRequested } from '../shared/stop'
import { humanMouseTo, humanPause, humanScroll, randInt } from '../shared/human'
import { config } from '../shared/config'
import { logger } from '../shared/logger'

export interface SeguindoOptions {
  /** coleta so esta semente, esteja ou nao vencida */
  username?: string
  limite?: number
  force?: boolean
}

export interface SeguindoResultado {
  semente: string
  contas: number
  privada?: boolean
  erro?: string
}

export interface SeguindoSummary {
  runId: string | null
  status: 'ok' | 'aborted' | 'failed' | 'skipped'
  sementes: SeguindoResultado[]
  parse?: ParseSummary
  reason?: string
}

/**
 * Sementes confirmadas da persona ativa cuja lista nao foi coletada nos
 * ultimos SEGUINDO_MIN_DIAS dias. Nunca coletadas primeiro.
 */
export async function filaSeguindo(limite: number): Promise<string[]> {
  const antesDe = new Date(Date.now() - config.SEGUINDO_MIN_DIAS * 86_400_000)
  const rows = await db
    .select({ username: semente.username })
    .from(semente)
    .innerJoin(persona, eq(persona.id, semente.personaId))
    .where(
      and(
        eq(persona.ativa, true),
        eq(semente.status, 'confirmada'),
        or(isNull(semente.coletadaEm), lt(semente.coletadaEm, antesDe)),
        // privada sem acesso nao adianta tentar toda semana
        sql`coalesce(${semente.privada}, false) = false`,
      ),
    )
    .orderBy(sql`${semente.coletadaEm} is not null`, asc(semente.coletadaEm))
    .limit(limite)
  return rows.map((r) => r.username)
}

function followingCountDe(body: unknown): number | undefined {
  const user = (body as { data?: { user?: Record<string, unknown> } } | null)?.data?.user
  if (!user) return undefined
  const edge = (user['edge_follow'] as { count?: unknown } | undefined)?.count
  const n = typeof edge === 'number' ? edge : user['following_count']
  return typeof n === 'number' ? n : undefined
}

async function marcarSemente(username: string, set: Partial<typeof semente.$inferInsert>): Promise<void> {
  // perfil sem nome nem bio chega aqui com set vazio, e o drizzle recusa UPDATE sem campos
  if (Object.values(set).every((v) => v === undefined)) return
  await db.update(semente).set(set).where(sql`lower(${semente.username}) = ${username}`)
}

/** O elemento que rola dentro do modal da lista (o proprio dialog nao rola). */
async function areaDoModal(page: Page): Promise<{ x: number; y: number } | null> {
  // string: o codigo roda no navegador, e o tsconfig do projeto nao tem a lib dom
  return page.evaluate<{ x: number; y: number } | null>(`(() => {
    const dialog = document.querySelector('div[role="dialog"]')
    if (!dialog) return null
    let melhor = null
    let folga = 0
    for (const el of Array.from(dialog.querySelectorAll('div'))) {
      const d = el.scrollHeight - el.clientHeight
      if (d > folga && getComputedStyle(el).overflowY !== 'visible') { folga = d; melhor = el }
    }
    const r = (melhor || dialog).getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + Math.min(r.height / 2, 260) }
  })()`)
}

/**
 * Abre o perfil de cada semente, clica em "seguindo" e rola o modal como
 * quem passa o olho na lista. Nao monta requisicao: as paginas da lista
 * chegam pelo proprio app (friendships/<id>/following) e o interceptor grava.
 * O parser transforma em arestas do grafo.
 */
export async function runSeguindo(options: SeguindoOptions = {}): Promise<SeguindoSummary> {
  assertNotStopped()
  const vazio: SeguindoSummary = { runId: null, status: 'skipped', sementes: [] }

  const breaker = breakerStatus()
  if (breaker.open && !options.force) {
    return { ...vazio, reason: `circuit breaker aberto ate ${breaker.until?.toISOString() ?? '?'}` }
  }
  if (!options.force) {
    const budget = await checkBudget('following')
    if (!budget.allowed) return { ...vazio, reason: budget.reason }
  }

  const fila = options.username
    ? [options.username.replace(/^@/, '').trim().toLowerCase()]
    : await filaSeguindo(options.limite ?? config.SEGUINDO_POR_SESSAO)
  if (fila.length === 0) {
    return {
      ...vazio,
      reason: `nenhuma semente para coletar: cadastre sementes na aba Sementes, ou todas foram coletadas nos ultimos ${config.SEGUINDO_MIN_DIAS} dias`,
    }
  }

  const [run] = await db
    .insert(collectionRun)
    .values({ kind: 'following', dayKey: localDayKey() })
    .returning({ id: collectionRun.id })
  if (!run) throw new Error('nao foi possivel criar o collection_run')

  const store = new RawStore(run.id)
  const deadline = Date.now() + config.SESSION_MAX_MINUTES * 60_000 * 2
  const resultados: SeguindoResultado[] = []
  let status: SeguindoSummary['status'] = 'ok'
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
    let alvo = ''
    let vistos = new Set<string>()
    let seguindoTotal: number | undefined
    handle = attachInterceptor(page, {
      onCapture: async (captured) => {
        await store.save(captured)
        const perfil = profileFromGraphql(captured.body, alvo)
        if (perfil) {
          await marcarSemente(alvo, {
            ...(perfil.fullName !== undefined ? { fullName: perfil.fullName } : {}),
            ...(perfil.biography !== undefined ? { biography: perfil.biography } : {}),
          })
          seguindoTotal = followingCountDe(captured.body) ?? seguindoTotal
        }
        if (sementeDaPagina(captured.pageUrl, captured.kind) === alvo && (captured.kind === 'following' || captured.kind === 'graphql')) {
          for (const u of extractFollowing(captured.body, captured.kind === 'following')) vistos.add(u.username)
        }
      },
      onRateLimited: () => {
        rateLimited = true
      },
    })

    for (const username of fila) {
      assertNotStopped()
      if (rateLimited) {
        status = 'aborted'
        abortReason = 'rate limit durante a coleta'
        break
      }
      if (Date.now() > deadline) {
        abortReason = 'tempo maximo de sessao atingido'
        break
      }

      alvo = username
      vistos = new Set<string>()
      seguindoTotal = undefined
      const resultado: SeguindoResultado = { semente: username, contas: 0 }
      await marcarSemente(username, { tentativaEm: new Date() })

      const url = `https://www.instagram.com/${username}/`
      const nav = await gotoWithRetry(page, url, 2)
      if (!nav.ok) {
        await recordSignal('nav_error', nav.error)
        resultado.erro = `nao abriu o perfil (${nav.error ?? '?'})`
        await marcarSemente(username, { erro: resultado.erro })
        resultados.push(resultado)
        continue
      }
      await humanPause(3_500, { min: 2_000, max: 9_000 })
      await dismissInterstitials(page, url)
      await handle.drain()

      const facts = extractProfileFromHtml(await page.content(), username)
      if (facts) {
        await marcarSemente(username, {
          ...(facts.fullName !== undefined ? { fullName: facts.fullName } : {}),
          ...(facts.biography !== undefined ? { biography: facts.biography } : {}),
        })
      }

      // o cabecalho do perfil carrega depois do HTML: espera o link aparecer
      const link = page.locator(`a[href*="/${username}/following"]`).or(page.getByRole('link', { name: /\bseguindo\b|\bfollowing\b/i })).first()
      const temLink = await link.waitFor({ state: 'visible', timeout: 12_000 }).then(() => true, () => false)
      const privada = /"is_private":true|Esta conta é privada|This account is private/i.test(await page.content())
      if (privada) {
        resultado.privada = true
        resultado.erro = 'conta privada'
        await marcarSemente(username, { privada: true, erro: resultado.erro })
        logger.warn({ semente: username }, 'conta privada: sem lista de seguindo')
        resultados.push(resultado)
        await humanPause(8_000, { min: 4_000, max: 20_000 })
        continue
      }

      if (temLink) {
        const caixa = await link.boundingBox()
        if (caixa) await humanMouseTo(page, caixa.x + caixa.width / 2, caixa.y + caixa.height / 2)
        await link.click()
      } else {
        // layout sem o link clicavel: o endereco da lista abre o mesmo modal
        logger.info({ semente: username }, 'link "seguindo" nao apareceu; abrindo a lista pelo endereco')
        await gotoWithRetry(page, `https://www.instagram.com/${username}/following/`, 2)
      }
      try {
        await page.waitForSelector('div[role="dialog"]', { timeout: 15_000 })
      } catch {
        resultado.erro = temLink ? 'o modal da lista nao abriu' : 'nao achei a lista "seguindo" no perfil'
        await marcarSemente(username, { erro: resultado.erro })
        // print da tela para entender o layout que o Instagram mostrou
        const print = `data/debug/seguindo-${username}-${Date.now()}.png`
        await page.screenshot({ path: print }).catch(() => undefined)
        logger.warn({ semente: username, erro: resultado.erro, print }, 'lista de seguindo indisponivel')
        resultados.push(resultado)
        await humanPause(8_000, { min: 4_000, max: 20_000 })
        continue
      }
      await humanPause(2_500, { min: 1_200, max: 6_000 })

      // rola ate o teto, ate a lista acabar ou ate parar de chegar gente nova
      const teto = config.SEGUINDO_MAX_POR_SEMENTE
      // nem toda rolagem traz pagina nova (a lista as vezes demora): folga de 2x
      const maxRodadas = Math.ceil(teto / 12) * 2 + 10
      let parado = 0
      for (let i = 0; i < maxRodadas; i++) {
        assertNotStopped()
        if (rateLimited || Date.now() > deadline) break
        await handle.drain()
        const antes = vistos.size
        if (antes >= teto) break
        if (seguindoTotal !== undefined && antes >= seguindoTotal) break

        const area = await areaDoModal(page)
        if (!area) break
        await humanMouseTo(page, area.x + randInt(-40, 40), area.y + randInt(-30, 30))
        await humanScroll(page, randInt(500, 1_000))
        await humanPause(1_800, { min: 900, max: 6_000 })
        // de vez em quando para, como quem le um nome
        if (Math.random() < 0.12) await humanPause(5_000, { min: 2_500, max: 12_000 })

        await handle.drain()
        parado = vistos.size > antes ? 0 : parado + 1
        if (parado >= 4) break
      }

      await page.keyboard.press('Escape').catch(() => undefined)
      await handle.drain()

      resultado.contas = vistos.size
      await marcarSemente(username, {
        ...(vistos.size > 0 ? { coletadaEm: new Date(), erro: null, privada: false } : { erro: 'nenhuma conta capturada na lista' }),
        ...(seguindoTotal !== undefined ? { followingCount: seguindoTotal } : {}),
      })
      logger.info({ semente: username, contas: vistos.size, total: seguindoTotal ?? '?' }, 'lista de seguindo coletada')
      resultados.push(resultado)

      await humanPause(15_000, { min: 6_000, max: 40_000 })
    }

    if (rateLimited) await recordSignal('rate_limited')
    else if (status === 'ok' && resultados.some((r) => r.contas > 0)) recordSuccess()
  } catch (error) {
    if (error instanceof StopRequested) {
      status = 'aborted'
      abortReason = abortReason ?? 'STOP solicitado'
    } else {
      status = 'failed'
      abortReason = error instanceof Error ? error.message : String(error)
      logger.error({ erro: abortReason, stack: error instanceof Error ? error.stack : undefined }, 'coleta de seguindo falhou')
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
        cardsSeen: resultados.reduce((n, r) => n + r.contas, 0),
        postsOpened: resultados.length,
        responsesCaptured: store.count,
        abortReason: abortReason ?? null,
      })
      .where(eq(collectionRun.id, run.id))
  }

  const summary: SeguindoSummary = { runId: run.id, status, sementes: resultados, reason: abortReason }
  if (store.count > 0) summary.parse = await parsePending(5_000)
  return summary
}
