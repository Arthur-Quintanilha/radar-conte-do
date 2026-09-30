import { createServer, type ServerResponse } from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { loadPainel, mediaPath } from './data'
import { setWatch } from '../collector/watchList'
import { buildPrompt, buildSelecaoPrompt, estimarTokens, selectCandidatas, selectContas, selectPosts } from '../llm/prompt'
import { corrigir, importarResposta } from '../llm/importar'
import type { IncomingMessage } from 'node:http'

/** Corpo JSON de um POST do proprio painel, com teto de tamanho. */
async function lerJson(req: IncomingMessage, max: number): Promise<Record<string, unknown>> {
  let corpo = ''
  for await (const parte of req) {
    corpo += String(parte)
    if (corpo.length > max) throw new Error(`corpo maior que ${max} caracteres`)
  }
  return JSON.parse(corpo || '{}') as Record<string, unknown>
}
import { logger } from '../shared/logger'

const HTML_PATH = resolve(dirname(fileURLToPath(import.meta.url)), 'index.html')

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
}

function send(res: ServerResponse, status: number, type: string, body: string | Buffer): void {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' })
  res.end(body)
}

function abrirNoNavegador(url: string): void {
  const [cmd, args] =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '""', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]]
  try {
    spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true }).unref()
  } catch {
    // sem navegador disponivel: o link no terminal basta
  }
}

/**
 * Servidor local do painel. So escuta em 127.0.0.1: nada fica exposto na rede.
 * Le o banco a cada requisicao, entao recarregar a pagina mostra o estado atual.
 */
export async function startPainel(port: number, open: boolean): Promise<void> {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')

    try {
      if (url.pathname === '/' || url.pathname === '/index.html') {
        // lido a cada vez: mudar o html nao exige reiniciar o servidor
        send(res, 200, 'text/html; charset=utf-8', await readFile(HTML_PATH))
        return
      }

      // marcar conta. O cabecalho proprio obriga o navegador a fazer preflight
      // de CORS, que este servidor nao responde: outro site aberto no seu
      // navegador nao consegue disparar isso por baixo dos panos
      if (url.pathname === '/api/watch' && req.method === 'POST') {
        if (req.headers['x-painel'] !== '1') {
          send(res, 403, 'text/plain; charset=utf-8', 'proibido')
          return
        }
        let corpo = ''
        for await (const parte of req) {
          corpo += String(parte)
          if (corpo.length > 10_000) break
        }
        const { username, status } = JSON.parse(corpo || '{}') as { username?: unknown; status?: unknown }
        const valido = status === 'acompanhar' || status === 'ignorar' || status === null
        if (typeof username !== 'string' || !/^[\w.]{1,40}$/.test(username) || !valido) {
          send(res, 400, 'text/plain; charset=utf-8', 'pedido invalido')
          return
        }
        const ok = await setWatch(username, status as 'acompanhar' | 'ignorar' | null)
        send(res, ok ? 200 : 404, 'application/json; charset=utf-8', JSON.stringify({ ok }))
        return
      }

      // classificacao por LLM: o painel gera o prompt, voce leva para a LLM e cola a resposta
      if (url.pathname === '/api/llm/prompt') {
        if (url.searchParams.get('tipo') === 'selecao') {
          const vagas = Math.min(100, Math.max(1, Number(url.searchParams.get('vagas')) || 15))
          const { candidatas, fixas } = selectCandidatas()
          const prompt = candidatas.length ? buildSelecaoPrompt(vagas, candidatas, fixas) : ''
          send(res, 200, 'application/json; charset=utf-8', JSON.stringify({ tipo: 'selecao', itens: candidatas.length, vagas, fixas: fixas.length, prompt, tokens: estimarTokens(prompt) }))
          return
        }
        const tipo = url.searchParams.get('tipo') === 'posts' ? 'posts' : 'contas'
        const limite = Math.min(100, Math.max(1, Number(url.searchParams.get('limite')) || 30))
        const refazer = url.searchParams.get('refazer') === '1'
        const { itens } = tipo === 'contas' ? selectContas(limite, refazer) : selectPosts(limite, refazer)
        const prompt = itens.length ? buildPrompt(tipo, itens) : ''
        send(res, 200, 'application/json; charset=utf-8', JSON.stringify({ tipo, itens: itens.length, prompt, tokens: estimarTokens(prompt) }))
        return
      }

      if ((url.pathname === '/api/llm/importar' || url.pathname === '/api/classificacao') && req.method === 'POST') {
        if (req.headers['x-painel'] !== '1') {
          send(res, 403, 'text/plain; charset=utf-8', 'proibido')
          return
        }
        if (url.pathname === '/api/llm/importar') {
          const corpo = await lerJson(req, 3_000_000)
          const texto = typeof corpo['texto'] === 'string' ? corpo['texto'] : ''
          const modelo = typeof corpo['modelo'] === 'string' ? corpo['modelo'] : 'manual'
          try {
            send(res, 200, 'application/json; charset=utf-8', JSON.stringify(await importarResposta(texto, modelo)))
          } catch (error) {
            send(res, 400, 'application/json; charset=utf-8', JSON.stringify({ erro: error instanceof Error ? error.message : String(error) }))
          }
          return
        }
        const corpo = await lerJson(req, 10_000)
        const alvo = corpo['alvo'] === 'post' ? 'post' : 'conta'
        const id = typeof corpo['id'] === 'string' ? corpo['id'] : ''
        const valor = typeof corpo['valor'] === 'string' ? corpo['valor'] : null
        if (!/^@?[\w.-]{1,60}$/.test(id)) {
          send(res, 400, 'text/plain; charset=utf-8', 'pedido invalido')
          return
        }
        const ok = await corrigir(alvo, id, valor)
        send(res, ok ? 200 : 404, 'application/json; charset=utf-8', JSON.stringify({ ok }))
        return
      }

      if (url.pathname === '/api/posts') {
        send(res, 200, 'application/json; charset=utf-8', JSON.stringify(await loadPainel()))
        return
      }

      const media = url.pathname.match(/^\/media\/([\w-]+)$/)
      if (media?.[1]) {
        const path = await mediaPath(media[1])
        if (!path || !existsSync(path)) {
          send(res, 404, 'text/plain; charset=utf-8', 'arquivo nao encontrado')
          return
        }
        const size = statSync(path).size
        const type = MIME[extname(path).toLowerCase()] ?? 'application/octet-stream'

        // o navegador pede pedacos do video para poder avancar e voltar; sem
        // suporte a Range o video toca, mas a barra de progresso nao funciona
        const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '')
        if (range) {
          let start = range[1] ? Number(range[1]) : 0
          let end = range[2] ? Number(range[2]) : size - 1
          if (!range[1] && range[2]) {
            start = Math.max(0, size - Number(range[2]))
            end = size - 1
          }
          end = Math.min(end, size - 1)
          if (start > end || start >= size) {
            res.writeHead(416, { 'content-range': `bytes */${size}` })
            res.end()
            return
          }
          res.writeHead(206, {
            'content-type': type,
            'content-length': end - start + 1,
            'content-range': `bytes ${start}-${end}/${size}`,
            'accept-ranges': 'bytes',
            'cache-control': 'max-age=3600',
          })
          createReadStream(path, { start, end }).pipe(res)
          return
        }

        res.writeHead(200, {
          'content-type': type,
          'content-length': size,
          'accept-ranges': 'bytes',
          'cache-control': 'max-age=3600',
        })
        createReadStream(path).pipe(res)
        return
      }

      send(res, 404, 'text/plain; charset=utf-8', 'nao encontrado')
    } catch (error) {
      logger.error({ error, rota: url.pathname }, 'erro no painel')
      send(res, 500, 'application/json; charset=utf-8', JSON.stringify({ erro: String(error) }))
    }
  })

  await new Promise<void>((ok, fail) => {
    server.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        fail(new Error(`a porta ${port} ja esta em uso. Feche o outro painel ou rode: npm run painel -- --port ${port + 1}`))
      } else fail(error)
    })
    server.listen(port, '127.0.0.1', () => ok())
  })

  const link = `http://localhost:${port}`
  console.log(`\n  Painel rodando em ${link}\n  Ctrl+C para parar.\n`)
  if (open) abrirNoNavegador(link)

  // segura o comando ate o Ctrl+C, para o banco nao ser fechado por baixo do servidor
  await new Promise<void>((ok) => {
    process.once('SIGINT', ok)
    process.once('SIGTERM', ok)
  })
  await new Promise<void>((ok) => server.close(() => ok()))
}
