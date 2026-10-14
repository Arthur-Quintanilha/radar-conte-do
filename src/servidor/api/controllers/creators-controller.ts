import type { Request, Response } from 'express'
import { z } from 'zod'
import { loadCreator } from '../../creator/painel'
import { corrigirPapel } from '../../creator/grafo'
import { adicionarSementes, atualizarPersona, criarPersona, salvarTerritorio, setStatusSemente } from '../../creator/persona'
import { adicionarReferencias, setStatusReferencia } from '../../creator/referencias'
import { corrigirEncaixe } from '../../creator/tarefas'
import { darAcesso, escolherPersona } from '../../web/usuarios'
import { creatorDoPedido, exigirAcesso, personaAtualDe, personasDe } from '../acesso'
import { quem } from '../middlewares/autenticar'
import { validar } from '../validar'

const visaoQuery = z.object({
  semana: z.string().optional(),
  visao: z.enum(['dia', 'semana']).optional(),
  dia: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

/**
 * GET /api/creators/:creatorId — tudo o que as telas mostram de um creator
 * (pauta da semana ou do dia, sementes, referências, grafo, funil). A lista
 * de creators vem filtrada pelo que essa pessoa pode ver.
 */
export async function obter(req: Request, res: Response): Promise<void> {
  const q = quem(req)
  const permitidas = await personasDe(q)
  const p = req.params['creatorId'] === 'atual' && !(await personaAtualDe(q)) ? null : await creatorDoPedido(req)
  const v = validar(visaoQuery, req.query)
  if (!p) {
    res.json({ personas: [], persona: null })
    return
  }
  const dados = await loadCreator(p.id, v.semana ?? null, { visao: v.visao ?? null, dia: v.dia ?? null })
  if (permitidas) dados.personas = dados.personas.filter((x: { id: string }) => permitidas.includes(x.id))
  res.json(dados)
}

const novoCreator = z.object({ nome: z.string().trim().min(1, 'nome obrigatorio').max(60), handle: z.string().max(40).optional().nullable() })

/** POST /api/creators — qualquer pessoa cria os seus; quem cria já ganha acesso e o creator fica escolhido. */
export async function criar(req: Request, res: Response): Promise<void> {
  const q = quem(req)
  const b = validar(novoCreator, req.body)
  const p = await criarPersona(b.nome, b.handle ?? undefined)
  await darAcesso(q, p.id)
  await escolherPersona(q, p.id)
  res.status(201).json({ ok: true, id: p.id })
}

/** POST /api/creators/:creatorId/escolher — o creator que essa pessoa vê (cada login tem o seu). */
export async function escolher(req: Request, res: Response): Promise<void> {
  const q = quem(req)
  const id = String(req.params['creatorId'])
  await exigirAcesso(q, id)
  await escolherPersona(q, id)
  res.json({ ok: true })
}

const perfil = z.object({
  nome: z.string().trim().min(1).max(60).optional(),
  handle: z.string().max(40).nullable().optional(),
  entrevista: z.record(z.string()).optional(),
})

/** PATCH /api/creators/:creatorId — nome, @ e entrevista. */
export async function atualizar(req: Request, res: Response): Promise<void> {
  const p = await creatorDoPedido(req)
  const b = validar(perfil, req.body)
  await atualizarPersona(p.id, { nome: b.nome, handle: b.handle, entrevista: b.entrevista })
  res.json({ ok: true })
}

/** PUT /api/creators/:creatorId/territorio — o schema do território é conferido pelo domínio. */
export async function salvarTerritorioDoCreator(req: Request, res: Response): Promise<void> {
  const p = await creatorDoPedido(req)
  const b = validar(z.object({ territorio: z.unknown() }), req.body)
  await salvarTerritorio(p.id, b.territorio)
  res.json({ ok: true })
}

const contas = z.object({ texto: z.string().max(20_000) })

/** POST /api/creators/:creatorId/sementes — uma ou várias (@, nome ou link). */
export async function adicionarSementesDoCreator(req: Request, res: Response): Promise<void> {
  const p = await creatorDoPedido(req)
  res.json({ ok: true, ...(await adicionarSementes(p.id, validar(contas, req.body).texto)) })
}

/** PATCH /api/creators/:creatorId/sementes/:username */
export async function statusSemente(req: Request, res: Response): Promise<void> {
  const p = await creatorDoPedido(req)
  const b = validar(z.object({ status: z.enum(['confirmada', 'rejeitada', 'remover']) }), req.body)
  await setStatusSemente(p.id, String(req.params['username']), b.status)
  res.json({ ok: true })
}

/** POST /api/creators/:creatorId/referencias */
export async function adicionarReferenciasDoCreator(req: Request, res: Response): Promise<void> {
  const p = await creatorDoPedido(req)
  res.json({ ok: true, ...(await adicionarReferencias(p.id, validar(contas, req.body).texto)) })
}

/** PATCH /api/creators/:creatorId/referencias/:username */
export async function statusReferencia(req: Request, res: Response): Promise<void> {
  const p = await creatorDoPedido(req)
  const b = validar(z.object({ status: z.enum(['ativa', 'pausada', 'remover']) }), req.body)
  await setStatusReferencia(p.id, String(req.params['username']), b.status)
  res.json({ ok: true })
}

/** PATCH /api/creators/:creatorId/contas/:username — corrige o papel de uma conta do grafo (null = volta para a IA). */
export async function papelDaConta(req: Request, res: Response): Promise<void> {
  const p = await creatorDoPedido(req)
  const b = validar(z.object({ papel: z.enum(['consumido', 'par', 'fora']).nullable() }), req.body)
  await corrigirPapel(p.id, String(req.params['username']), b.papel)
  res.json({ ok: true })
}

/** PATCH /api/creators/:creatorId/encaixes/:shortcode — corrige a avaliação de um post (null = volta para a IA). */
export async function encaixeDoPost(req: Request, res: Response): Promise<void> {
  const p = await creatorDoPedido(req)
  const b = validar(z.object({ valor: z.enum(['dentro', 'radar', 'fora']).nullable(), radarTema: z.string().max(60).nullable().optional() }), req.body)
  await corrigirEncaixe(p.id, String(req.params['shortcode']), b.valor, b.radarTema ?? null)
  res.json({ ok: true })
}
