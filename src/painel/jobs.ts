import { spawn, type ChildProcess } from 'node:child_process'
import { resolve } from 'node:path'

/**
 * O painel dispara as etapas como processos separados do mesmo CLI: o que roda
 * no painel e exatamente o que roda no terminal, e um navegador travado nao
 * derruba o servidor. Um de cada vez.
 */
export const COMANDOS: Record<string, { args: string[]; rotulo: string; navegador?: boolean }> = {
  semana: { args: ['semana'], rotulo: 'Ciclo completo', navegador: true },
  'semana-analise': { args: ['semana', '--sem-coleta'], rotulo: 'Só a análise (sem navegador)' },
  seguindo: { args: ['seguindo'], rotulo: 'Coletar "seguindo" das sementes', navegador: true },
  grafo: { args: ['grafo'], rotulo: 'Recalcular o grafo' },
  acompanhar: { args: ['semana', '--etapas', 'acompanhar'], rotulo: 'Visitar as contas do grafo', navegador: true },
  whisper: { args: ['semana', '--etapas', 'whisper'], rotulo: 'Transcrever os reels' },
  territorio: { args: ['ia', 'territorio'], rotulo: 'Gerar o território' },
  contas: { args: ['ia', 'contas'], rotulo: 'Classificar as contas do grafo' },
  encaixe: { args: ['ia', 'encaixe'], rotulo: 'Avaliar o encaixe dos posts' },
  pauta: { args: ['ia', 'pauta'], rotulo: 'Gerar mais ideias' },
  health: { args: ['health'], rotulo: 'Conferir a sessão do Instagram', navegador: true },
}

interface Job {
  cmd: string
  rotulo: string
  inicio: number
  fim: number | null
  codigo: number | null
  saida: string[]
}

let atual: Job | null = null
let filho: ChildProcess | null = null
const MAX_LINHAS = 600

// tira as cores do pino-pretty
const semCor = (t: string) => t.replace(/\x1b\[[0-9;]*m/g, '')

export function estadoJob(): (Job & { rodando: boolean }) | null {
  return atual ? { ...atual, rodando: filho !== null } : null
}

/** Etapas que rodam para uma conta so (menu ao lado de cada conta no painel). */
export const ACOES_CONTA: Record<string, string> = {
  visitar: 'Visitar',
  transcrever: 'Transcrever os reels de',
  classificar: 'Classificar a conta',
  avaliar: 'Avaliar os posts de',
  seguindo: 'Coletar o "seguindo" de',
  atualizar: 'Atualizar tudo de',
}

function definicao(cmd: string, conta?: string): { args: string[]; rotulo: string } | { erro: string } {
  if (!cmd.startsWith('conta-')) return COMANDOS[cmd] ?? { erro: `comando desconhecido: ${cmd}` }
  const acao = cmd.slice('conta-'.length)
  const u = (conta ?? '').replace(/^@/, '').trim().toLowerCase()
  if (!ACOES_CONTA[acao]) return { erro: `acao desconhecida: ${acao}` }
  if (!/^[a-z0-9._]{1,30}$/.test(u)) return { erro: `conta invalida: ${conta ?? ''}` }
  return { args: ['conta', u, acao], rotulo: `${ACOES_CONTA[acao]} @${u}` }
}

export function iniciarJob(cmd: string, conta?: string): { ok: boolean; erro?: string } {
  const def = definicao(cmd, conta)
  if ('erro' in def) return { ok: false, erro: def.erro }
  if (filho) return { ok: false, erro: `ja tem uma etapa rodando: ${atual?.rotulo}` }

  const job: Job = { cmd, rotulo: def.rotulo, inicio: Date.now(), fim: null, codigo: null, saida: [] }
  atual = job
  const push = (b: Buffer) => {
    for (const l of semCor(String(b)).split(/\r?\n/)) {
      if (!l.trim()) continue
      job.saida.push(l)
      if (job.saida.length > MAX_LINHAS) job.saida.splice(0, job.saida.length - MAX_LINHAS)
    }
  }
  const p = spawn(process.execPath, ['--import', 'tsx', resolve(process.cwd(), 'src', 'cli', 'index.ts'), ...def.args], {
    cwd: process.cwd(),
    env: { ...process.env, FORCE_COLOR: '0' },
    windowsHide: true,
  })
  filho = p
  p.stdout.on('data', push)
  p.stderr.on('data', push)
  p.on('error', (e) => job.saida.push(`erro ao iniciar: ${e.message}`))
  p.on('close', (code) => {
    job.fim = Date.now()
    job.codigo = code
    filho = null
  })
  return { ok: true }
}

export function pararJob(): boolean {
  if (!filho) return false
  atual?.saida.push('— interrompido pelo painel —')
  filho.kill()
  return true
}
