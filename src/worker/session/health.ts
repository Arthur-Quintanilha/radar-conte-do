import type { BrowserContext } from 'patchright'
import { getPage } from './browser'
import { gotoWithRetry } from './navigate'
import { humanPause } from '../../comum/human'
import { logger } from '../../comum/logger'

export type HealthStatus = 'ok' | 'logged_out' | 'challenge' | 'rate_limited' | 'soft_block' | 'error'

export interface HealthResult {
  status: HealthStatus
  detail?: string
  userId?: string
}

const SOFT_BLOCK_HINTS = [
  'Please wait a few minutes',
  'Aguarde alguns minutos',
  'Tente novamente mais tarde',
  'Try again later',
]

/** Decide se pode coletar. Roda antes de toda sessao. */
export async function checkHealth(context: BrowserContext): Promise<HealthResult> {
  const page = await getPage(context)
  let sawRateLimit = false

  const onResponse = (response: { status: () => number; url: () => string }) => {
    if (response.status() === 429 && response.url().includes('instagram.com')) sawRateLimit = true
  }
  page.on('response', onResponse)

  try {
    const nav = await gotoWithRetry(page, 'https://www.instagram.com/')
    if (!nav.ok) {
      return { status: 'error', detail: nav.error ?? 'navegacao falhou' }
    }
    await humanPause(2_500)

    const url = page.url()
    if (url.includes('/challenge') || url.includes('/accounts/suspended')) {
      return { status: 'challenge', detail: url }
    }
    if (url.includes('/accounts/login')) {
      return { status: 'logged_out', detail: url }
    }

    const cookies = await context.cookies('https://www.instagram.com')
    const dsUserId = cookies.find((c) => c.name === 'ds_user_id')?.value
    if (!dsUserId) {
      return { status: 'logged_out', detail: 'cookie ds_user_id ausente' }
    }

    if (sawRateLimit) return { status: 'rate_limited', userId: dsUserId }

    const body = (await page.textContent('body')) ?? ''
    const hint = SOFT_BLOCK_HINTS.find((h) => body.includes(h))
    if (hint) return { status: 'soft_block', detail: hint, userId: dsUserId }

    return { status: 'ok', userId: dsUserId }
  } catch (error) {
    logger.error({ err: error }, 'health check falhou')
    return { status: 'error', detail: error instanceof Error ? error.message : String(error) }
  } finally {
    page.off('response', onResponse)
  }
}
