import type { Request, Response } from 'express'
import { z } from 'zod'
import { listarPersonas } from '../../creator/persona'
import { atualizarUsuario, criarUsuario, definirAcesso, listarUsuarios } from '../../web/usuarios'
import { quem } from '../middlewares/autenticar'
import { validar } from '../validar'
import { config } from '../../../comum/config'

const papel = z.enum(['admin', 'membro'])

/** GET /api/admin/usuarios — quem tem acesso e todos os creators (para marcar). */
export async function listar(_req: Request, res: Response): Promise<void> {
  const personas = (await listarPersonas()).map((p) => ({ id: p.id, nome: p.nome, handle: p.handle }))
  res.json({ usuarios: await listarUsuarios(), personas, limitePadraoUsd: config.LIMITE_IA_MENSAL_USD ?? null })
}

const novo = z.object({
  email: z.string().email('e-mail invalido'),
  senha: z.string().min(8, 'a senha precisa de pelo menos 8 caracteres').optional(),
  nome: z.string().max(80).optional(),
  papel: papel.optional(),
  personas: z.array(z.string()).optional(),
})

/** POST /api/admin/usuarios — cria o login no Supabase (ou reaproveita) e o cadastro local. */
export async function criar(req: Request, res: Response): Promise<void> {
  const u = await criarUsuario(validar(novo, req.body))
  res.status(201).json({ ok: true, usuario: u })
}

const edicao = z.object({
  nome: z.string().max(80).nullable().optional(),
  papel: papel.optional(),
  ativo: z.boolean().optional(),
  senha: z.string().min(8, 'a senha precisa de pelo menos 8 caracteres').optional(),
  personas: z.array(z.string()).optional(),
  /** US$ por mes; null volta ao padrao do servidor, 0 corta a IA */
  limiteIaUsd: z.number().min(0).max(10_000).nullable().optional(),
})

/** PATCH /api/admin/usuarios/:usuarioId — papel, nome, ativo, senha e creators liberados. */
export async function atualizar(req: Request, res: Response): Promise<void> {
  const id = String(req.params['usuarioId'])
  const b = validar(edicao, req.body)
  await atualizarUsuario(id, { nome: b.nome, papel: b.papel, ativo: b.ativo, senha: b.senha, limiteIaUsd: b.limiteIaUsd }, quem(req))
  if (b.personas) await definirAcesso(id, b.personas)
  res.json({ ok: true })
}
