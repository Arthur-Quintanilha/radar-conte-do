import { spawn, type ChildProcess } from 'node:child_process'
import { resolve } from 'node:path'
import { lerCiclo } from './ciclo/ciclo'

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
  /** creator de quem disparou: vai para o processo como PERSONA_ID */
  personaId?: string | null
  conta?: string
  minimo?: number | null
  /** voce apertou parar: o painel oferece continuar de onde parou */
  parado?: boolean
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

export function estadoJob(): (Job & { rodando: boolean; retomar: string | null }) | null {
  return atual ? { ...atual, rodando: filho !== null, retomar: filho ? null : retomada()?.descricao ?? null } : null
}

const CICLOS = new Set(['semana', 'semana-analise'])

/**
 * Como continuar a ultima execucao que voce parou. O ciclo volta pela etapa em
 * que parou (as anteriores ja terminaram); uma etapa avulsa roda de novo e
 * continua sozinha, porque cada etapa pula o que ja foi feito (contas visitadas
 * nas ultimas horas, reels transcritos, posts avaliados).
 */
function retomada(): { args: string[]; rotulo: string; descricao: string } | null {
  if (!atual?.parado || filho) return null
  if (CICLOS.has(atual.cmd)) {
    const c = lerCiclo()
    if (!c) return null
    const restantes = c.etapas.filter((e) => !c.feitas.includes(e))
    if (!restantes.length) return null
    const args = ['semana', '--etapas', restantes.join(','), ...(c.minimo ? ['--minimo', String(c.minimo)] : []), ...(c.refazerPauta ? ['--refazer-pauta'] : [])]
    return { args, rotulo: `Ciclo (continuando de ${restantes[0]})`, descricao: `continua de "${restantes[0]}" (${restantes.length} de ${c.etapas.length} etapas)` }
  }
  const base = definicao(atual.cmd, atual.conta)
  if ('erro' in base) return null
  const args = atual.minimo && COM_PAUTA.has(atual.cmd) ? [...base.args, '--minimo', String(atual.minimo)] : base.args
  return { args, rotulo: `${base.rotulo} (continuando)`, descricao: 'roda de novo pulando o que já foi feito' }
}

/** creator da ultima execucao (com `rodando`, so se ainda estiver rodando) */
export function personaDaRetomada(rodando = false): string | null {
  if (!atual || (rodando && !filho)) return null
  return atual.personaId ?? (CICLOS.has(atual.cmd) ? lerCiclo()?.personaId ?? null : null)
}

export function retomarJob(): { ok: boolean; erro?: string } {
  const r = retomada()
  if (!r) return { ok: false, erro: 'não há execução parada para continuar' }
  const anterior = atual!
  return lancar({ cmd: anterior.cmd, conta: anterior.conta, minimo: anterior.minimo, personaId: anterior.personaId }, r.args, r.rotulo)
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

/** comandos que terminam gerando a pauta: aceitam um minimo de ideias */
const COM_PAUTA = new Set(['semana', 'semana-analise', 'pauta'])

export function iniciarJob(cmd: string, conta?: string, minimo?: number | null, personaId?: string | null): { ok: boolean; erro?: string } {
  const base = definicao(cmd, conta)
  if ('erro' in base) return { ok: false, erro: base.erro }
  const n = minimo && Number.isInteger(minimo) && minimo > 0 && minimo <= 50 ? minimo : null
  const def = n && COM_PAUTA.has(cmd) ? { ...base, args: [...base.args, '--minimo', String(n)], rotulo: `${base.rotulo} (mín. ${n} ideias)` } : base
  return lancar({ cmd, conta, minimo: n, personaId }, def.args, def.rotulo)
}

function lancar(o: { cmd: string; conta?: string; minimo?: number | null; personaId?: string | null }, args: string[], rotulo: string): { ok: boolean; erro?: string } {
  if (filho) return { ok: false, erro: `ja tem uma etapa rodando: ${atual?.rotulo}` }
  const def = { args, rotulo }
  const job: Job = { cmd: o.cmd, conta: o.conta, minimo: o.minimo, personaId: o.personaId ?? null, rotulo: def.rotulo, inicio: Date.now(), fim: null, codigo: null, saida: [] }
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
    env: { ...process.env, FORCE_COLOR: '0', ...(o.personaId ? { PERSONA_ID: o.personaId } : {}) },
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
  if (atual) atual.parado = true
  filho.kill()
  return true
}
