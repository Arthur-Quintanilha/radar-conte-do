import type { EndpointKind } from './capturas'
import type { ProfileFacts } from './parser/profileExtract'

/**
 * O contrato entre o trabalhador local (worker: Chrome, mídia, Whisper) e o
 * servidor (banco, IA, regras). O worker nunca fala com o banco: tudo passa
 * por aqui. Hoje a implementação chama o servidor no mesmo processo
 * (servidor/portaDireta.ts); no app desktop vira chamadas HTTP para a API.
 *
 * Só tipos que viajam bem em JSON: datas em milissegundos, nada de classe.
 */

export type TipoColeta = 'watch' | 'following'

export interface CapturaEnviada {
  url: string
  pageUrl: string
  kind: EndpointKind
  status: number
  body: unknown
  bodyHash: string
  /** ms */
  capturedAt: number
}

export interface ResumoColeta {
  status: 'ok' | 'aborted' | 'failed' | 'skipped'
  cardsSeen?: number
  postsOpened?: number
  responsesCaptured?: number
  abortReason?: string | null
}

export interface ResumoParse {
  rawProcessed: number
  medias: number
  postsNew: number
  postsUpdated: number
  authors: number
  metrics: number
  hashtags: number
  assets: number
  skipped: number
  searchMedias: number
  profileMedias: number
  profilesUpdated: number
  appearances: number
  arestas: number
  failures: number
}

export interface ContaFila {
  id: string
  username: string
}

/** O que a coleta descobre de uma semente. Datas em ms; null limpa o campo. */
export interface DadosSemente {
  fullName?: string
  biography?: string
  followingCount?: number
  privada?: boolean
  erro?: string | null
  tentativaEm?: number
  coletadaEm?: number
}

/** Uma mídia do Instagram que pode ser baixada (a URL do CDN expira em horas). */
export interface MidiaRemota {
  id: string
  shortcode: string
  position: number
  kind: string
  url: string
}

/** Uma mídia que o worker procura na pasta local pelo nome (shortcode/posição-tipo). */
export interface MidiaDoPost {
  postId: string
  shortcode: string
  position: number
}

export interface FilaWhisper {
  /** contas que vão primeiro na fila (as fontes de conteúdo da persona) */
  autores?: string[]
  /** true: transcreve SÓ os vídeos dessas contas */
  somenteAutores?: boolean
  /** posts mais novos que isso vão primeiro (com somenteAutores, só eles entram) */
  desdeDias?: number
}

export interface PersonaDoCiclo {
  id: string
  nome: string
}

/** Etapas do ciclo que rodam no servidor (banco e IA). */
export type EtapaServidor = 'grafo' | 'contas' | 'encaixe' | 'pauta'

export interface OpcoesEtapa {
  personaId: string
  /** só estas contas (contas, encaixe) */
  so?: string[]
  refazer?: boolean
  /** pauta: mínimo de ideias */
  minimo?: number | null
}

export interface ResultadoEtapa {
  /** o que mostrar no log, já em português */
  linha: string
  /** quantos itens a etapa gravou (contas classificadas, posts avaliados, ideias) */
  gravados: number
  /** a etapa não rodou por falta de algo (ex.: chave de API) */
  pulou?: boolean
  /** lotes que a IA respondeu (contas, encaixe) */
  lotes?: number
  /** por que não gravou nada, quando a etapa explica */
  motivo?: string
}

export interface Servidor {
  // ---- coleta
  /** a coleta deste tipo pode rodar agora? (janela, teto do dia, folga) */
  orcamento(tipo: TipoColeta): Promise<{ allowed: boolean; reason: string }>
  abrirColeta(tipo: TipoColeta): Promise<string>
  salvarCaptura(runId: string, captura: CapturaEnviada): Promise<void>
  fecharColeta(runId: string, resumo: ResumoColeta): Promise<void>
  /** transforma as capturas pendentes em posts, autores, métricas e arestas */
  processarCapturas(): Promise<ResumoParse>
  /** quem está marcado para acompanhar e não foi visitado nas últimas horas */
  filaAcompanhar(limite: number, permitidos?: string[]): Promise<ContaFila[]>
  contaPorUsername(username: string): Promise<ContaFila | null>
  marcarVisitada(authorId: string): Promise<void>
  aplicarPerfil(authorId: string, perfil: ProfileFacts): Promise<void>
  /** sementes da persona ativa com a lista de "seguindo" vencida */
  filaSeguindo(limite: number): Promise<string[]>
  marcarSemente(username: string, dados: DadosSemente): Promise<void>

  // ---- mídia e transcrição (os arquivos ficam no computador; o servidor só guarda texto)
  midiasParaBaixar(limite: number): Promise<MidiaRemota[]>
  midiaBaixada(id: string): Promise<void>
  midiaFalhou(id: string, erro: string): Promise<void>
  /** legendas .srt do Instagram de posts que ainda não têm a transcrição dele */
  legendasSemTexto(limite: number): Promise<MidiaDoPost[]>
  /** vídeos sem transcrição deste modelo, na ordem da fila (limite 0 = todos) */
  videosSemTranscricao(modelo: string, fila: FilaWhisper, limite: number): Promise<MidiaDoPost[]>
  gravarTranscricao(postId: string, modelo: string, texto: string): Promise<void>
  apagarTranscricoesWhisper(): Promise<number>

  // ---- ciclo
  /** a persona do ciclo (a escolhida para esta execução, ou a ativa) */
  persona(): Promise<PersonaDoCiclo>
  /** contas que esta persona acompanha: grafo consumido + referências ativas */
  contasDaPersona(personaId: string): Promise<string[]>
  /** só as referências ativas da persona */
  referenciasDaPersona(personaId: string): Promise<string[]>
  /** cria a linha de autor das referências novas, para a visita achar */
  sincronizarReferencias(): Promise<void>
  temIA(): Promise<boolean>
  etapa(nome: EtapaServidor, opcoes: OpcoesEtapa): Promise<ResultadoEtapa>
}
