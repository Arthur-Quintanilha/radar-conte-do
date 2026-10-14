import { Router, type RequestHandler } from 'express'
import * as eu from './controllers/eu-controller'
import * as creators from './controllers/creators-controller'
import * as ideias from './controllers/ideias-controller'
import * as tarefas from './controllers/tarefas-controller'
import * as admin from './controllers/admin-controller'
import * as etapas from './controllers/etapas-controller'
import * as worker from './controllers/worker-controller'
import * as legado from './controllers/legado-controller'
import { autenticar, exigirCabecalhoPainel, soAdmin } from './middlewares/autenticar'
import { comImagens } from './middlewares/imagens'

type Metodo = 'get' | 'post' | 'put' | 'patch' | 'delete'

export interface Rota {
  metodo: Metodo
  caminho: string
  descricao: string
  grupo: string
  admin?: boolean
  handlers: RequestHandler[]
}

/** Todas as rotas da API, num lugar só (também vira a documentação em /docs). */
export const ROTAS: Rota[] = [
  { metodo: 'get', caminho: '/eu', grupo: 'Conta', descricao: 'Quem está logado: papel e creators liberados (null = todos)', handlers: [eu.eu] },

  { metodo: 'post', caminho: '/creators', grupo: 'Creators', descricao: 'Cria um creator (quem cria ganha acesso e ele fica escolhido)', handlers: [creators.criar] },
  { metodo: 'get', caminho: '/creators/:creatorId', grupo: 'Creators', descricao: 'Tudo de um creator: pauta, sementes, referências, grafo e funil. "atual" = o que você está vendo. Query: semana, visao (dia|semana), dia', handlers: [creators.obter] },
  { metodo: 'patch', caminho: '/creators/:creatorId', grupo: 'Creators', descricao: 'Nome, @ e entrevista', handlers: [creators.atualizar] },
  { metodo: 'post', caminho: '/creators/:creatorId/escolher', grupo: 'Creators', descricao: 'Escolhe o creator que você vê (cada login tem o seu)', handlers: [creators.escolher] },
  { metodo: 'put', caminho: '/creators/:creatorId/territorio', grupo: 'Creators', descricao: 'Salva o território', handlers: [creators.salvarTerritorioDoCreator] },
  { metodo: 'post', caminho: '/creators/:creatorId/sementes', grupo: 'Sementes e referências', descricao: 'Adiciona sementes (@, nome ou link; várias de uma vez)', handlers: [creators.adicionarSementesDoCreator] },
  { metodo: 'patch', caminho: '/creators/:creatorId/sementes/:username', grupo: 'Sementes e referências', descricao: 'Confirma, rejeita ou remove uma semente', handlers: [creators.statusSemente] },
  { metodo: 'post', caminho: '/creators/:creatorId/referencias', grupo: 'Sementes e referências', descricao: 'Adiciona referências', handlers: [creators.adicionarReferenciasDoCreator] },
  { metodo: 'patch', caminho: '/creators/:creatorId/referencias/:username', grupo: 'Sementes e referências', descricao: 'Ativa, pausa ou remove uma referência', handlers: [creators.statusReferencia] },
  { metodo: 'patch', caminho: '/creators/:creatorId/contas/:username', grupo: 'Sementes e referências', descricao: 'Corrige o papel de uma conta do grafo (null = volta para a IA)', handlers: [creators.papelDaConta] },
  { metodo: 'patch', caminho: '/creators/:creatorId/encaixes/:shortcode', grupo: 'Pauta', descricao: 'Corrige a avaliação de um post (null = volta para a IA)', handlers: [creators.encaixeDoPost] },
  { metodo: 'get', caminho: '/creators/:creatorId/tarefas/:tipo', grupo: 'IA à mão', descricao: 'Monta o prompt de uma etapa de IA para levar a uma conversa (territorio, contas, encaixe, pauta)', handlers: [tarefas.montar] },
  { metodo: 'post', caminho: '/creators/:creatorId/tarefas/:tipo', grupo: 'IA à mão', descricao: 'Aplica a resposta colada da IA', handlers: [tarefas.aplicarResposta] },

  { metodo: 'get', caminho: '/ideias/:ideiaId', grupo: 'Pauta', descricao: 'Detalhe da ideia: posts de referência, pergunta do ângulo e versões de roteiro', handlers: [ideias.obter] },
  { metodo: 'post', caminho: '/ideias/:ideiaId/resposta', grupo: 'Pauta', descricao: 'Vou postar, recusar (motivo e nota) ou desfazer', handlers: [ideias.responder] },
  { metodo: 'post', caminho: '/ideias/:ideiaId/adotar', grupo: 'Pauta', descricao: 'Tema do radar entra no território', handlers: [ideias.adotar] },
  { metodo: 'post', caminho: '/ideias/:ideiaId/dispensar', grupo: 'Pauta', descricao: 'Tema do radar: não é pra mim', handlers: [ideias.dispensar] },
  { metodo: 'post', caminho: '/ideias/:ideiaId/roteiros', grupo: 'Roteiro', descricao: 'Gera uma versão nova com a IA. Pode responder 409 com faltamImagens: mande as imagens em `imagens` e repita', handlers: [comImagens(), ideias.gerar] },
  { metodo: 'post', caminho: '/ideias/:ideiaId/roteiros/prompt', grupo: 'Roteiro', descricao: 'Prompt do roteiro para o fluxo manual', handlers: [ideias.prompt] },
  { metodo: 'post', caminho: '/ideias/:ideiaId/roteiros/manual', grupo: 'Roteiro', descricao: 'Grava a resposta colada da IA', handlers: [ideias.colar] },
  { metodo: 'delete', caminho: '/ideias/:ideiaId/roteiros', grupo: 'Roteiro', descricao: 'Apaga todas as versões (começar do zero)', handlers: [ideias.apagar] },
  { metodo: 'post', caminho: '/ideias/:ideiaId/roteiros/:roteiroId/edicao', grupo: 'Roteiro', descricao: 'A edição vira uma versão nova', handlers: [ideias.salvarEdicaoDoRoteiro] },
  { metodo: 'patch', caminho: '/roteiros/:roteiroId', grupo: 'Roteiro', descricao: 'Texto editado ou status (rascunho, gravado)', handlers: [ideias.atualizarRoteiro] },

  { metodo: 'get', caminho: '/etapas', grupo: 'Etapas (só no app)', descricao: 'A última etapa e o log', handlers: [etapas.estado] },
  { metodo: 'post', caminho: '/etapas', grupo: 'Etapas (só no app)', descricao: 'Começa uma etapa (cmd, conta, minimo, persona)', handlers: [etapas.iniciar] },
  { metodo: 'post', caminho: '/etapas/parar', grupo: 'Etapas (só no app)', descricao: 'Para a etapa que está rodando', handlers: [etapas.parar] },
  { metodo: 'post', caminho: '/etapas/continuar', grupo: 'Etapas (só no app)', descricao: 'Continua a última execução parada', handlers: [etapas.continuar] },

  { metodo: 'get', caminho: '/admin/usuarios', grupo: 'Administração', admin: true, descricao: 'Usuários e creators', handlers: [admin.listar] },
  { metodo: 'post', caminho: '/admin/usuarios', grupo: 'Administração', admin: true, descricao: 'Cria um usuário', handlers: [admin.criar] },
  { metodo: 'patch', caminho: '/admin/usuarios/:usuarioId', grupo: 'Administração', admin: true, descricao: 'Edita papel, nome, ativo, senha e creators', handlers: [admin.atualizar] },

  { metodo: 'post', caminho: '/worker/:metodo', grupo: 'Worker', descricao: `O contrato do app instalado com o servidor (comum/porta.ts). Corpo: { args: [...], imagens? }. Cabeçalho x-persona: o creator da execução. Métodos: ${worker.metodosDoWorker.join(', ')}`, handlers: [comImagens(), worker.chamar] },

  // painel antigo: sai quando ele for aposentado
  { metodo: 'get', caminho: '/creator', grupo: 'Painel antigo', descricao: 'Compatibilidade', handlers: [legado.creator] },
  { metodo: 'get', caminho: '/creator/ideia', grupo: 'Painel antigo', descricao: 'Compatibilidade', handlers: [legado.ideia] },
  { metodo: 'get', caminho: '/creator/job', grupo: 'Painel antigo', descricao: 'Compatibilidade', handlers: [legado.job] },
  { metodo: 'post', caminho: '/creator/job', grupo: 'Painel antigo', descricao: 'Compatibilidade', handlers: [legado.job] },
  { metodo: 'get', caminho: '/creator/tarefa', grupo: 'Painel antigo', descricao: 'Compatibilidade', handlers: [legado.tarefa] },
  { metodo: 'post', caminho: '/creator/tarefa', grupo: 'Painel antigo', descricao: 'Compatibilidade', handlers: [legado.tarefa] },
  { metodo: 'post', caminho: '/creator/acao', grupo: 'Painel antigo', descricao: 'Compatibilidade', handlers: [comImagens(), legado.acao] },
]

/** O roteador /api: autentica tudo, exige x-painel em quem muda algo, e admin onde for o caso. */
export function roteadorApi(): Router {
  const r = Router()
  r.use(autenticar(), exigirCabecalhoPainel())
  for (const rota of ROTAS) r[rota.metodo](rota.caminho, ...(rota.admin ? [soAdmin()] : []), ...rota.handlers)
  r.use((_req, res) => {
    res.status(404).json({ erro: 'rota nao encontrada' })
  })
  return r
}
