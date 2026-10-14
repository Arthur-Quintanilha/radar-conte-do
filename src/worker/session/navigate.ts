import type { Page } from 'patchright'
import { humanPause } from '../../comum/human'
import { logger } from '../../comum/logger'

export interface NavResult {
  ok: boolean
  status?: number
  error?: string
}

function firstLine(error: unknown): string {
  if (!(error instanceof Error)) return String(error)
  return error.message.split('\n')[0] ?? error.message
}

/**
 * O Instagram as vezes responde uma navegacao direta com erro HTTP sem corpo,
 * e o Chrome traduz isso em ERR_HTTP_RESPONSE_CODE_FAILURE. Isso nao e motivo
 * para derrubar o processo: tenta de novo com espera crescente e devolve o
 * resultado para quem chamou decidir o que fazer.
 */
export async function gotoWithRetry(page: Page, url: string, attempts = 3): Promise<NavResult> {
  let last = ''

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await page.goto(url, { waitUntil: 'domcontentloaded' })
      const status = response?.status()

      if (status !== undefined && status >= 400) {
        last = `HTTP ${status}`
        logger.warn({ url, status, attempt }, 'navegacao devolveu erro HTTP')
      } else {
        return { ok: true, status }
      }
    } catch (error) {
      last = firstLine(error)
      logger.warn({ url, attempt, erro: last }, 'navegacao falhou')
    }

    if (attempt < attempts) await humanPause(4_000 * attempt, { min: 2_000, max: 30_000 })
  }

  return { ok: false, error: last }
}

/**
 * O Instagram as vezes intercala a tela "Salvar suas informacoes de login?"
 * (/accounts/onetap/) antes da pagina pedida. Recusa e segue; se nao achar o
 * botao, volta para o destino.
 */
export async function dismissInterstitials(page: Page, destino: string): Promise<void> {
  if (!page.url().includes('/accounts/onetap')) return
  logger.info('tela de salvar login apareceu; recusando')
  try {
    await page
      .getByRole('button', { name: /agora n[aã]o|not now/i })
      .or(page.getByRole('link', { name: /agora n[aã]o|not now/i }))
      .first()
      .click({ timeout: 6_000 })
    await page.waitForURL((u) => !u.pathname.startsWith('/accounts/onetap'), { timeout: 10_000 })
  } catch {
    await gotoWithRetry(page, destino, 2)
  }
  await humanPause(2_000, { min: 1_000, max: 4_000 })
}
