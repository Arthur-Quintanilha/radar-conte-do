import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'patchright'
import type { BrowserContext, Page } from 'patchright'
import { config } from '../../comum/config'
import { logger } from '../../comum/logger'

/**
 * Contexto persistente: cookies, localStorage, cache e device id sobrevivem
 * entre runs. E o que evita relogin, que e o maior gatilho de checkpoint.
 *
 * Nao usamos headless nem argumentos de stealth manuais: o patchright ja cuida
 * dos vazamentos de CDP, e flags extras costumam piorar o fingerprint.
 */
export async function launchContext(): Promise<BrowserContext> {
  const profileDir = resolve(process.cwd(), config.PROFILE_DIR)
  mkdirSync(profileDir, { recursive: true })

  logger.debug({ profileDir }, 'abrindo contexto persistente')

  const context = await chromium.launchPersistentContext(profileDir, {
    channel: config.CHROME_PATH ? undefined : 'chrome',
    executablePath: config.CHROME_PATH || undefined,
    headless: false,
    viewport: null,
    locale: config.LOCALE,
    timezoneId: config.TZ_NAME,
    args: [`--window-size=${config.WINDOW_WIDTH},${config.WINDOW_HEIGHT}`],
  })

  context.setDefaultTimeout(45_000)
  return context
}

export async function getPage(context: BrowserContext): Promise<Page> {
  const existing = context.pages()[0]
  if (existing) return existing
  return context.newPage()
}
