import type { Page, Response } from 'patchright'
import { logger } from '../shared/logger'

export type EndpointKind =
  | 'explore_grid'
  | 'graphql'
  | 'media_info'
  | 'comments'
  | 'profile'
  | 'feed'
  | 'search'
  /** qualquer outro JSON do Instagram; so gravado no modo captureAll */
  | 'other'
  /** blocos JSON embutidos no HTML da pagina (perfil e renderizado no servidor) */
  | 'html'

export interface Captured {
  url: string
  /** pagina aberta no momento da captura, para saber a procedencia do dado */
  pageUrl: string
  kind: EndpointKind
  status: number
  body: unknown
  capturedAt: Date
}

const MAX_BODY_BYTES = 8 * 1024 * 1024

/** So nos interessam as respostas que o proprio app do Instagram ja pede. */
export function classify(url: string): EndpointKind | null {
  if (!url.includes('instagram.com')) return null
  if (url.includes('/api/v1/discover/web/explore_grid')) return 'explore_grid'
  if (url.includes('/graphql/query')) return 'graphql'
  // resultados da busca (PolarisKeywordSearchExplorePageRelayQuery) vem por aqui
  if (url.includes('/api/graphql')) return 'graphql'
  if (/\/api\/v1\/media\/\d+\/info/.test(url)) return 'media_info'
  if (/\/api\/v1\/media\/\d+\/comments/.test(url)) return 'comments'
  if (url.includes('/api/v1/users/web_profile_info')) return 'profile'
  if (url.includes('/api/v1/feed/')) return 'feed'
  if (/\/fbsearch\/|\/web\/search\/|topsearch|\/api\/v1\/tags\//.test(url)) return 'search'
  return null
}

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
