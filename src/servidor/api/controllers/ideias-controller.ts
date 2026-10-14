import type { Request, Response } from 'express'
import { z } from 'zod'
import { detalheIdeia } from '../../creator/painel'
import { adotarRadar, dispensarRadar, responderIdeia } from '../../creator/pauta'
import { apagarRoteiros, aplicarRoteiro, editarRoteiro, gerarRoteiro, listarRoteiros, marcarRoteiro, montarRoteiro, perguntaDoAngulo, salvarEdicao, textoRoteiro } from '../../creator/roteiro'
import { modeloPauta, temApi } from '../../creator/llm'
import { estimarTokens } from '../../ia/json'
import { ideiaDoPedido, roteiroDoPedido } from '../acesso'
import { naoEncontrado } from '../erros'
import { validar } from '../validar'

/** GET /api/ideias/:ideiaId — o detalhe: posts de referência, pergunta do ângulo e as versões de roteiro. */
export async function obter(req: Request, res: Response): Promise<void> {
  const id = await ideiaDoPedido(req)
  const d = await detalheIdeia(id)
  if (!d) throw naoEncontrado('ideia nao encontrada')
  const roteiros = (await listarRoteiros(d.id)).map((r) => ({ ...r, textoPadrao: textoRoteiro(r.conteudo) }))
  res.json({ ...d, pergunta: perguntaDoAngulo(d.angulo), roteiros, roteiroApi: temApi(), roteiroModelo: modeloPauta() })
}

const resposta = z.object({
  status: z.enum(['aceita', 'recusada', 'nova']),
  motivo: z.string().max(40).optional(),
  nota: z.string().max(600).optional(),
})

/** POST /api/ideias/:ideiaId/resposta — vou postar, recusar (motivo e nota) ou desfazer. */
export async function responder(req: Request, res: Response): Promise<void> {
  const id = await ideiaDoPedido(req)
  const b = validar(resposta, req.body)
  await responderIdeia(id, b)
  res.json({ ok: true })
}

/** POST /api/ideias/:ideiaId/adotar — tema do radar entra no território (pessoal ou profissional). */
export async function adotar(req: Request, res: Response): Promise<void> {
  const id = await ideiaDoPedido(req)
  const b = validar(z.object({ como: z.enum(['pessoal', 'temas']).default('pessoal'), detalhe: z.string().max(400).optional() }), req.body)
  await adotarRadar(id, b.como, b.detalhe)
  res.json({ ok: true })
}

/** POST /api/ideias/:ideiaId/dispensar — "não é pra mim". */
export async function dispensar(req: Request, res: Response): Promise<void> {
  await dispensarRadar(await ideiaDoPedido(req))
  res.json({ ok: true })
}

const pedidoRoteiro = z.object({ resposta: z.string().max(4000).optional(), pedido: z.string().max(300).optional() })

/** POST /api/ideias/:ideiaId/roteiros — gera uma versão nova com a IA (com as imagens do post de referência). */
export async function gerar(req: Request, res: Response): Promise<void> {
  const id = await ideiaDoPedido(req)
  const r = await gerarRoteiro(id, validar(pedidoRoteiro, req.body))
  res.status(201).json({ ok: true, roteiro: r.id, versao: r.versao })
}

/** POST /api/ideias/:ideiaId/roteiros/prompt — o prompt para levar a uma conversa com a IA (fluxo manual). */
export async function prompt(req: Request, res: Response): Promise<void> {
  const id = await ideiaDoPedido(req)
  const m = await montarRoteiro(id, { ...validar(pedidoRoteiro, req.body), comImagens: false })
  res.json({ ok: true, prompt: m.prompt, tokens: estimarTokens(m.prompt) })
}

/** POST /api/ideias/:ideiaId/roteiros/manual — grava a resposta que a IA deu no fluxo manual. */
export async function colar(req: Request, res: Response): Promise<void> {
  const id = await ideiaDoPedido(req)
  const b = validar(pedidoRoteiro.extend({ texto: z.string().min(1, 'cole a resposta da IA').max(200_000) }), req.body)
  const m = await montarRoteiro(id, { resposta: b.resposta, pedido: b.pedido, comImagens: false })
  const r = await aplicarRoteiro(id, b.texto, 'manual', { resposta: m.resposta, pedido: m.pedido, formatoDe: m.formatoDe, peca: m.peca })
  res.status(201).json({ ok: true, roteiro: r.id, versao: r.versao })
}

/** DELETE /api/ideias/:ideiaId/roteiros — começar do zero (apaga todas as versões). */
export async function apagar(req: Request, res: Response): Promise<void> {
  res.json({ ok: true, apagados: await apagarRoteiros(await ideiaDoPedido(req)) })
}

/** POST /api/ideias/:ideiaId/roteiros/:roteiroId/edicao — a edição vira uma versão nova; a da IA fica no histórico. */
export async function salvarEdicaoDoRoteiro(req: Request, res: Response): Promise<void> {
  const id = await ideiaDoPedido(req)
  const b = validar(z.object({ conteudo: z.record(z.unknown()) }), req.body)
  const r = await salvarEdicao(id, String(req.params['roteiroId']), b.conteudo)
  res.status(201).json({ ok: true, roteiro: r.id, versao: r.versao })
}

/** PATCH /api/roteiros/:roteiroId — texto livre editado ou status (rascunho, gravado). */
export async function atualizarRoteiro(req: Request, res: Response): Promise<void> {
  const id = await roteiroDoPedido(req)
  const b = validar(z.object({ texto: z.string().max(100_000).optional(), status: z.enum(['rascunho', 'gravado']).optional() }), req.body)
  if (b.texto !== undefined) await editarRoteiro(id, b.texto)
  if (b.status) await marcarRoteiro(id, b.status)
  res.json({ ok: true })
}
