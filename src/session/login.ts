import { getPage, launchContext } from './browser'
import { gotoWithRetry } from './navigate'
import { checkHealth } from './health'
import { sleep } from '../shared/human'
import { logger } from '../shared/logger'

const TIMEOUT_MS = 10 * 60 * 1000

/** A raiz e mais tolerante que /accounts/login/ e redireciona sozinha. */
const START_URLS = ['https://www.instagram.com/', 'https://www.instagram.com/accounts/login/']

/**
 * Login manual assistido. O script nunca digita a senha: automatizar o login
 * e o gatilho mais confiavel de checkpoint que existe no Instagram.
 *
 * Se a navegacao automatica falhar, o processo nao morre — a janela fica
 * aberta e voce pode digitar o endereco na mao. O que importa e a sessao
 * acabar salva no perfil persistente.
 */
export async function runLogin(): Promise<boolean> {
  const context = await launchContext()

  try {
    const page = await getPage(context)

    let landed = false
    for (const url of START_URLS) {
      const result = await gotoWithRetry(page, url, 2)
      if (result.ok) {
        landed = true
        break
      }
      logger.warn({ url, motivo: result.error }, 'nao consegui abrir esta URL')
    }

    if (landed) {
      logger.info('Faca o login na janela do Chrome. Resolva o 2FA se pedir.')
    } else {
      logger.warn('Nao consegui abrir o Instagram automaticamente.')
      logger.warn('Digite instagram.com na barra de endereco da janela que abriu e faca o login por la.')
      logger.warn('Se der erro ali tambem, o bloqueio vem do seu IP ou da conta, nao do script.')
    }

    logger.info('Esperando ate 10 minutos. A janela fecha sozinha quando a sessao for detectada.')

    const deadline = Date.now() + TIMEOUT_MS
    while (Date.now() < deadline) {
      const cookies = await context.cookies('https://www.instagram.com')
      if (cookies.some((c) => c.name === 'ds_user_id' && c.value)) {
        await sleep(3_000)
        const health = await checkHealth(context)
        if (health.status === 'ok') {
          logger.info({ userId: health.userId }, 'sessao salva no perfil persistente')
          return true
        }
        logger.warn({ health }, 'cookie presente mas health check nao passou')
      }
      await sleep(3_000)
    }

    logger.error('tempo esgotado sem detectar login')
    return false
  } finally {
    await context.close()
  }
}
