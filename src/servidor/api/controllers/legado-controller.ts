import type { Request, Response } from 'express'
import * as creators from './creators-controller'
import * as ideias from './ideias-controller'
import * as tarefas from './tarefas-controller'
import * as etapas from './etapas-controller'
import { invalido } from '../erros'

/**
 * As rotas do painel antigo (src/servidor/painel/creator.js), traduzidas para
 * os controllers novos. Ficam só até o painel antigo ser aposentado; o app
 * novo usa as rotas REST.
 */

const s = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)

function com(req: Request, params: Record<string, string>, body?: unknown): Request {
  // Express 5: req.params e req.body podem ser trocados antes de chamar o handler
  req.params = { ...req.params, ...params } as Request['params']
  if (body !== undefined) req.body = body
  return req
}

/** GET /api/creator?persona=&semana=&visao=&dia= */
export async function creator(req: Request, res: Response): Promise<void> {
  const persona = s(req.query['persona'])
  await creators.obter(com(req, { creatorId: persona ?? 'atual' }), res)
}

/** GET /api/creator/ideia?id= */
export async function ideia(req: Request, res: Response): Promise<void> {
  await ideias.obter(com(req, { ideiaId: String(req.query['id'] ?? '') }), res)
}

/** GET|POST /api/creator/job */
export async function job(req: Request, res: Response): Promise<void> {
  if (req.method === 'GET') return etapas.estado(req, res)
  const b = (req.body ?? {}) as Record<string, unknown>
  if (b['parar']) return etapas.parar(req, res)
  if (b['retomar']) return etapas.continuar(req, res)
  return etapas.iniciar(req, res)
}

/** GET /api/creator/tarefa?tipo=&persona=&refazer=1 e POST {tipo, persona, texto, modelo} */
export async function tarefa(req: Request, res: Response): Promise<void> {
  if (req.method === 'GET') {
    return tarefas.montar(com(req, { creatorId: s(req.query['persona']) ?? 'atual', tipo: String(req.query['tipo'] ?? '') }), res)
  }
  const b = (req.body ?? {}) as Record<string, unknown>
  return tarefas.aplicarResposta(com(req, { creatorId: s(b['persona']) ?? 'atual', tipo: String(b['tipo'] ?? '') }), res)
}

/** POST /api/creator/acao {acao, persona, ...} */
export async function acao(req: Request, res: Response): Promise<void> {
  const b = (req.body ?? {}) as Record<string, unknown>
  const creatorId = s(b['persona']) ?? 'atual'
  const id = String(b['id'] ?? '')
  const roteiro = String(b['roteiro'] ?? '')
  switch (b['acao']) {
    case 'persona.criar':
      return creators.criar(com(req, {}, { nome: b['nome'], handle: b['handle'] }), res)
    case 'persona.ativar':
      return creators.escolher(com(req, { creatorId: String(b['persona'] ?? '') }), res)
    case 'persona.salvar':
      return creators.atualizar(com(req, { creatorId }, { nome: b['nome'], handle: b['handle'], entrevista: b['entrevista'] }), res)
    case 'territorio.salvar':
      return creators.salvarTerritorioDoCreator(com(req, { creatorId }, { territorio: b['territorio'] }), res)
    case 'sementes.add':
      return creators.adicionarSementesDoCreator(com(req, { creatorId }, { texto: b['texto'] ?? '' }), res)
    case 'semente.status':
      return creators.statusSemente(com(req, { creatorId, username: String(b['username'] ?? '') }, { status: b['status'] }), res)
    case 'referencias.add':
      return creators.adicionarReferenciasDoCreator(com(req, { creatorId }, { texto: b['texto'] ?? '' }), res)
    case 'referencia.status':
      return creators.statusReferencia(com(req, { creatorId, username: String(b['username'] ?? '') }, { status: b['status'] }), res)
    case 'conta.papel':
      return creators.papelDaConta(com(req, { creatorId, username: String(b['username'] ?? '') }, { papel: s(b['papel']) ?? null }), res)
    case 'encaixe.corrigir':
      return creators.encaixeDoPost(com(req, { creatorId, shortcode: String(b['shortcode'] ?? '') }, { valor: s(b['valor']) ?? null, radarTema: b['radarTema'] ?? null }), res)
    case 'ideia.responder':
      return ideias.responder(com(req, { ideiaId: id }, { status: b['status'], motivo: s(b['motivo']), nota: s(b['nota']) }), res)
    case 'radar.adotar':
      return ideias.adotar(com(req, { ideiaId: id }, { como: b['como'] === 'temas' ? 'temas' : 'pessoal', detalhe: s(b['detalhe']) }), res)
    case 'radar.dispensar':
      return ideias.dispensar(com(req, { ideiaId: id }), res)
    case 'roteiro.gerar':
      return ideias.gerar(com(req, { ideiaId: id }, { resposta: s(b['resposta']), pedido: s(b['pedido']) }), res)
    case 'roteiro.prompt':
      return ideias.prompt(com(req, { ideiaId: id }, { resposta: s(b['resposta']), pedido: s(b['pedido']) }), res)
    case 'roteiro.colar':
      return ideias.colar(com(req, { ideiaId: id }, { resposta: s(b['resposta']), pedido: s(b['pedido']), texto: b['texto'] ?? '' }), res)
    case 'roteiro.apagar':
      return ideias.apagar(com(req, { ideiaId: id }), res)
    case 'roteiro.salvar':
      return ideias.salvarEdicaoDoRoteiro(com(req, { ideiaId: id, roteiroId: roteiro }, { conteudo: b['conteudo'] }), res)
    case 'roteiro.editar':
      return ideias.atualizarRoteiro(com(req, { roteiroId: roteiro }, { texto: s(b['texto']) ?? '' }), res)
    case 'roteiro.status':
      return ideias.atualizarRoteiro(com(req, { roteiroId: roteiro }, { status: b['status'] }), res)
    default:
      throw invalido(`acao desconhecida: ${String(b['acao'])}`)
  }
}
