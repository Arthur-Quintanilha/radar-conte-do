import express, { type Express } from 'express'
import cors from 'cors'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { dirname, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { serve, setup } from 'swagger-ui-express'
import { roteadorApi } from './rotas'
import { documentacao } from './docs'
import { tratarErro } from './middlewares/erro'
import { autenticar } from './middlewares/autenticar'

/** acha o arquivo de uma mídia no computador (só no app instalado ou no painel local) */
export type AcharMidia = (shortcode: string, position: number, kind: string) => string | null

export interface OpcoesApp {
  /** serve /media/<shortcode>/<posição>-<tipo> a partir da pasta local */
  acharMidia?: AcharMidia
  /** serve o painel antigo em / (index.html e creator.js) */
  painelAntigo?: boolean
  /** origens que podem chamar a API pelo navegador (o app Angular em desenvolvimento) */
  origens?: string[]
}

const MIME: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.mp4': 'video/mp4', '.webm': 'video/webm', '.srt': 'text/plain; charset=utf-8' }
const PASTA_PAINEL = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'painel')

/** O app Express da API. Quem roda escolhe o que entra (mídia local, painel antigo). */
export function criarApp(o: OpcoesApp = {}): Express {
  const app = express()
  app.disable('x-powered-by')
  // so as origens conhecidas; sem isso o navegador nao deixa outro site chamar a API
  app.use(cors({ origin: o.origens ?? false, allowedHeaders: ['authorization', 'content-type', 'x-painel', 'x-persona'] }))
  // capturas do Instagram e imagens das etapas de IA vem grandes
  app.use(express.json({ limit: '25mb' }))

  app.get('/api/saude', (_req, res) => {
    res.json({ ok: true })
  })
  app.get('/docs.json', (_req, res) => {
    res.json(documentacao())
  })
  app.use('/docs', serve, setup(undefined, { swaggerUrl: '/docs.json', customSiteTitle: 'Radar de conteúdo · API' }))
  app.use('/api', roteadorApi())

  if (o.acharMidia) {
    const achar = o.acharMidia
    app.get('/media/:shortcode/:arquivo', autenticarMidia(), (req, res) => {
      const m = /^(\d+)-(image|video|subtitle)$/.exec(String(req.params['arquivo']))
      const shortcode = String(req.params['shortcode'])
      const path = m && /^[\w-]+$/.test(shortcode) ? achar(shortcode, Number(m[1]), m[2]!) : null
      if (!path || !existsSync(path)) {
        res.status(404).type('text/plain').send('arquivo nao encontrado')
        return
      }
      enviarArquivo(req.headers.range, path, res)
    })
  }

  if (o.painelAntigo) {
    app.get(['/', '/index.html'], (_req, res) => {
      res.set('cache-control', 'no-store').sendFile(resolve(PASTA_PAINEL, 'index.html'))
    })
    app.get('/creator.js', (_req, res) => {
      res.set('cache-control', 'no-store').type('text/javascript').sendFile(resolve(PASTA_PAINEL, 'creator.js'))
    })
  }

  app.use(tratarErro)
  return app
}

/**
 * <img> e <video> nao mandam o cabecalho do token. A midia so existe no
 * computador de quem coletou e o servidor local so escuta em 127.0.0.1; com
 * login ligado, o token pode vir em ?t=.
 */
function autenticarMidia(): express.RequestHandler {
  const auth = autenticar()
  return (req, res, next) => {
    if (typeof req.query['t'] === 'string' && !req.headers.authorization) req.headers.authorization = `Bearer ${req.query['t']}`
    return auth(req, res, next)
  }
}

/** video com suporte a Range: sem ele o video toca, mas a barra de progresso nao funciona */
function enviarArquivo(range: string | undefined, path: string, res: express.Response): void {
  const size = statSync(path).size
  const type = MIME[extname(path).toLowerCase()] ?? 'application/octet-stream'
  const r = /^bytes=(\d*)-(\d*)$/.exec(range ?? '')
  if (r) {
    let start = r[1] ? Number(r[1]) : 0
    let end = r[2] ? Number(r[2]) : size - 1
    if (!r[1] && r[2]) {
      start = Math.max(0, size - Number(r[2]))
      end = size - 1
    }
    end = Math.min(end, size - 1)
    if (start > end || start >= size) {
      res.status(416).set('content-range', `bytes */${size}`).end()
      return
    }
    res.writeHead(206, { 'content-type': type, 'content-length': end - start + 1, 'content-range': `bytes ${start}-${end}/${size}`, 'accept-ranges': 'bytes', 'cache-control': 'max-age=3600' })
    createReadStream(path, { start, end }).pipe(res)
    return
  }
  res.writeHead(200, { 'content-type': type, 'content-length': size, 'accept-ranges': 'bytes', 'cache-control': 'max-age=3600' })
  createReadStream(path).pipe(res)
}
