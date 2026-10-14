import type { Request, Response } from 'express'
import { z } from 'zod'
import { podeVer } from '../../web/usuarios'
import { exigirAcesso, personaAtualDe } from '../acesso'
import { conflito, ErroHttp, proibido } from '../erros'
import { quem } from '../middlewares/autenticar'
import { validar } from '../validar'

/**
 * As etapas (Buscar ideias, visitar, transcrever...) rodam no computador de
 * quem clica. Quem monta o programa liga aqui o controle delas (o worker
 * local); a API na nuvem não tem, e responde 501.
 */
export interface ControleJobs {
  comandos: Record<string, { args: string[]; rotulo: string; navegador?: boolean }>
  estado(): { personaId?: string | null; saida: string[]; rotulo: string } | null
  iniciar(cmd: string, conta: string | undefined, minimo: number | null, personaId: string | null): { ok: boolean; erro?: string }
  parar(): boolean
  retomar(): { ok: boolean; erro?: string }
  /** creator da ultima execucao (com `rodando`, so se ainda estiver rodando) */
  personaDaUltima(rodando?: boolean): string | null
}

let jobs: ControleJobs | null = null
export function definirControleJobs(c: ControleJobs | null): void {
  jobs = c
}
function controle(): ControleJobs {
  if (!jobs) throw new ErroHttp(501, 'este servidor nao roda etapas: elas rodam no app instalado')
  return jobs
}

/** o creator da etapa: o do corpo ou o que essa pessoa está vendo */
async function creatorDaEtapa(req: Request, persona?: string): Promise<string> {
  const q = quem(req)
  const id = persona || (await personaAtualDe(q))
  if (!id) throw conflito('escolha um creator no topo')
  await exigirAcesso(q, id)
  return id
}

/** GET /api/etapas — a última etapa e o log. Etapa de outro creator aparece sem o conteúdo. */
export async function estado(req: Request, res: Response): Promise<void> {
  const c = controle()
  const job = c.estado()
  const visivel = !job?.personaId || (await podeVer(quem(req), job.personaId))
  res.json({ job: visivel ? job : job ? { ...job, saida: [], rotulo: 'Etapa de outro creator' } : null, comandos: c.comandos })
}

const nova = z.object({ cmd: z.string().min(1), conta: z.string().max(40).optional(), minimo: z.coerce.number().int().min(1).max(50).nullable().optional(), persona: z.string().optional() })

/** POST /api/etapas — começa uma etapa (uma de cada vez). */
export async function iniciar(req: Request, res: Response): Promise<void> {
  const b = validar(nova, req.body)
  const persona = await creatorDaEtapa(req, b.persona)
  const r = controle().iniciar(b.cmd, b.conta, b.minimo ?? null, persona)
  res.status(r.ok ? 202 : 409).json(r)
}

/** POST /api/etapas/parar */
export async function parar(req: Request, res: Response): Promise<void> {
  const c = controle()
  const dono = c.personaDaUltima(true)
  if (dono && !(await podeVer(quem(req), dono))) throw proibido('essa execução é de um creator que você não acessa')
  res.json({ ok: c.parar() })
}

/** POST /api/etapas/continuar — retoma a última execução parada (o ciclo volta pela etapa em que parou). */
export async function continuar(req: Request, res: Response): Promise<void> {
  const c = controle()
  const b = validar(z.object({ persona: z.string().optional() }), req.body)
  const minha = await creatorDaEtapa(req, b.persona)
  const dono = c.personaDaUltima()
  const r = dono && dono !== minha ? { ok: false, erro: 'a execução parada é de outro creator: escolha ele no topo para continuar' } : c.retomar()
  res.status(r.ok ? 202 : 409).json(r)
}
