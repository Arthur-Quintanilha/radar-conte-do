import { spawn } from 'node:child_process'
import type { Server } from 'node:http'
import { criarApp, type AcharMidia } from '../api/app'

export type { AcharMidia }

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

/** escuta e devolve o servidor; porta ocupada vira uma mensagem que diz o que fazer */
export async function escutar(app: ReturnType<typeof criarApp>, port: number, host: string): Promise<Server> {
  return new Promise<Server>((ok, fail) => {
    const server = app.listen(port, host)
    server.once('listening', () => ok(server))
    server.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') fail(new Error(`a porta ${port} ja esta em uso. Feche o outro painel ou rode: npm run painel -- --port ${port + 1}`))
      else fail(error)
    })
  })
}

/**
 * Painel local: a API, o painel antigo e as mídias da pasta, tudo no mesmo
 * processo. Só escuta em 127.0.0.1: nada fica exposto na rede.
 */
export async function startPainel(port: number, open: boolean, acharMidia?: AcharMidia): Promise<void> {
  const app = criarApp({ acharMidia, painelAntigo: true, origens: ['http://localhost:4200'] })
  const server = await escutar(app, port, '127.0.0.1')
  const link = `http://localhost:${port}`
  console.log(`\n  Painel rodando em ${link} (API em ${link}/api, documentação em ${link}/docs)\n  Ctrl+C para parar.\n`)
  if (open) abrirNoNavegador(link)

  // segura o comando ate o Ctrl+C, para o banco nao ser fechado por baixo do servidor
  await new Promise<void>((ok) => {
    process.once('SIGINT', ok)
    process.once('SIGTERM', ok)
  })
  await new Promise<void>((ok) => server.close(() => ok()))
}

/**
 * Só a API, para a nuvem: sem painel antigo e sem mídia local (os arquivos
 * ficam no computador de quem coletou). PORT vem do provedor.
 */
export async function startApi(port: number, host: string, origens: string[]): Promise<void> {
  const app = criarApp({ origens, atrasDeProxy: true })
  const server = await escutar(app, port, host)
  console.log(`\n  API em http://${host}:${port}/api (documentação em /docs)\n`)
  await new Promise<void>((ok) => {
    process.once('SIGINT', ok)
    process.once('SIGTERM', ok)
  })
  await new Promise<void>((ok) => server.close(() => ok()))
}
