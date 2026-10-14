import type { Request, Response } from 'express'
import { z } from 'zod'
import { aplicarPauta, montarPauta } from '../../creator/pauta'
import { aplicar, montarContas, montarEncaixe, montarTerritorio } from '../../creator/tarefas'
import { estimarTokens } from '../../ia/json'
import { creatorDoPedido } from '../acesso'
import { validar } from '../validar'

/**
 * O fluxo manual das etapas de IA: o painel monta o prompt, você leva para uma
 * conversa com a IA e cola a resposta. Sem imagens (só texto).
 */
const tipo = z.enum(['territorio', 'contas', 'encaixe', 'pauta'])

/** GET /api/creators/:creatorId/tarefas/:tipo?refazer=1 */
export async function montar(req: Request, res: Response): Promise<void> {
  const p = await creatorDoPedido(req)
  const t = validar(tipo, req.params['tipo'])
  const refazer = req.query['refazer'] === '1'
  const m = t === 'territorio' ? montarTerritorio(p) : t === 'contas' ? await montarContas(p, 25, refazer) : t === 'encaixe' ? await montarEncaixe(p, 20, refazer) : await montarPauta(p)
  res.json({ tipo: m.tipo, itens: m.itens, prompt: m.prompt, motivo: m.motivo, tokens: estimarTokens(m.prompt) })
}

/** POST /api/creators/:creatorId/tarefas/:tipo — aplica a resposta colada. */
export async function aplicarResposta(req: Request, res: Response): Promise<void> {
  const p = await creatorDoPedido(req)
  const t = validar(tipo, req.params['tipo'])
  const b = validar(z.object({ texto: z.string().min(1, 'cole a resposta da IA').max(3_000_000), modelo: z.string().max(80).optional() }), req.body)
  const modelo = b.modelo || 'manual'
  res.json(t === 'pauta' ? await aplicarPauta(p, b.texto, modelo, undefined, 'mais') : await aplicar(t, p, b.texto, modelo))
}
