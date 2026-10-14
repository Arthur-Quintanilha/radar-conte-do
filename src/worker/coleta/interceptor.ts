import type { Page, Response } from 'patchright'
import { logger } from '../../comum/logger'

import { classify, type Captured, type EndpointKind } from '../../comum/capturas'

export type { Captured, EndpointKind }

const MAX_BODY_BYTES = 8 * 1024 * 1024

export interface InterceptorOptions {
  onCapture: (captured: Captured) => Promise<void> | void
  onRateLimited?: () => Promise<void> | void
  /**
   * Grava todo JSON vindo do Instagram, mesmo de endpoint desconhecido.
   * So para sondagem: serve para descobrir o que uma pagina nova pede.
   */
  captureAll?: boolean
}

export interface InterceptorHandle {
  detach: () => void
  drain: () => Promise<void>
  readonly captured: number
  readonly readFailures: number
}

/**
 * Escuta as respostas em vez de montar requisicoes proprias. Assim headers,
 * tokens e doc_id vem sempre corretos, e o trafego e o mesmo de um uso real.
 */
export function attachInterceptor(page: Page, options: InterceptorOptions): InterceptorHandle {
  let captured = 0
  let readFailures = 0
  const pending = new Set<Promise<void>>()

  const process = async (response: Response): Promise<void> => {
    const url = response.url()
    const known = classify(url)
    const kind: EndpointKind | null =
      known ?? (options.captureAll && url.includes('instagram.com') ? 'other' : null)
    if (!kind) return

    const status = response.status()
    if (status === 429) {
      await options.onRateLimited?.()
      return
    }
    if (status >= 400) return

    const contentType = response.headers()['content-type'] ?? ''
    const isJson = contentType.includes('json')
    // /api/graphql (onde chega a busca) responde JSON como text/javascript, as
    // vezes prefixado com "for (;;);"; o corpo e conferido abaixo antes do parse
    if (!isJson && !/javascript|text\/html|text\/plain/.test(contentType)) return

    try {
      const buffer = await response.body()
      if (buffer.byteLength > MAX_BODY_BYTES) {
        logger.warn({ url, bytes: buffer.byteLength }, 'resposta grande demais, ignorada')
        return
      }
      const text = buffer.toString('utf8').replace(/^for \(;;\);/, '')
      if (!isJson && !/^\s*[[{]/.test(text)) return
      const body: unknown = JSON.parse(text)
      captured++
      await options.onCapture({ url, pageUrl: page.url(), kind, status, body, capturedAt: new Date() })
    } catch (error) {
      readFailures++
      logger.debug({ url, error }, 'nao foi possivel ler o corpo da resposta')
    }
  }

  const handler = (response: Response) => {
    const task = process(response).catch((error: unknown) => {
      logger.debug({ error }, 'erro no interceptor')
    })
    pending.add(task)
    void task.finally(() => pending.delete(task))
  }

  page.on('response', handler)

  return {
    detach: () => page.off('response', handler),
    drain: async () => {
      await Promise.allSettled([...pending])
    },
    get captured() {
      return captured
    },
    get readFailures() {
      return readFailures
    },
  }
}
