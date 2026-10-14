import { HttpClient, HttpErrorResponse } from '@angular/common/http'
import { Injectable, inject } from '@angular/core'
import { firstValueFrom } from 'rxjs'

export interface PersonaResumo {
  id: string
  nome: string
  handle: string | null
  ativa: boolean
  temTerritorio: boolean
}

export interface PostMini {
  shortcode: string
  autor: string
  tipo: string | null
  legenda: string
  thumb: string | null
  likes: number | null
  comments: number | null
  takenAt: number | null
}

export interface Ideia {
  id: string
  tipo: 'pauta' | 'radar' | string
  ordem: number
  titulo: string
  porQue: string | null
  angulo: string | null
  hook: string | null
  formato: string | null
  status: string
  motivo: string | null
  nota: string | null
  score: number | null
  createdAt: number
  roteiros: number
  posts: PostMini[]
}

export type Papel = 'admin' | 'membro'

export interface PersonaCurta {
  id: string
  nome: string
  handle: string | null
}

export interface UsuarioAdmin {
  id: string
  email: string
  nome: string | null
  papel: Papel
  ativo: boolean
  personas: string[]
  createdAt: number | string
}

export interface Eu {
  id: string
  email: string
  papel: 'admin' | 'membro'
  local: boolean
  personas: string[] | null
}

/** O que GET /api/creator devolve (so os campos que as telas usam por enquanto). */
export interface Melhor {
  shortcode: string
  autor: string
  thumb: string | null
  legenda: string
  tema: string | null
  temaTerritorio: string | null
  angulo: string | null
  radarTema: string | null
  score: number
  porQue: string
}

export interface PostDetalhe {
  shortcode: string
  autor: string
  autorNome: string | null
  autorBio: string | null
  autorCategoria: string | null
  verificado: boolean
  seguidores: number | null
  tipo: string | null
  legenda: string
  takenAt: number | null
  likes: number | null
  comments: number | null
  plays: number | null
  duracao: number | null
  slides: number
  audio: string | null
  local: string | null
  hashtags: string[]
  alt: string | null
  transcricoes: { fonte: string; texto: string }[]
  semFala: boolean
  midias: { imagem: string | null; video: string | null }[]
  features: { diaSemana: string | null; hora: number | null; publi: boolean | null } | null
  desempenho: number | null
  postsDoAutor: number
  sementes: number
  totalSementes: number
  encaixe: { encaixe: string; tema: string | null; temaTerritorio: string | null; angulo: string | null; motivo: string | null; confianca: number | null } | null
}

export interface RoteiroConteudo {
  molde: string
  formato_de: string
  formato: string
  peca: string
  gravacao: string
  duracao_s: number | null
  audio: { tipo: string; nome: string; nota: string }
  ganchos: { texto: string; entonacao: string }[]
  fala: string
  tom: string
  tela: string[]
  legenda: string
  lembretes: string[]
}

export interface Roteiro {
  id: string
  ideiaId: string
  versao: number
  resposta: string | null
  pedido: string | null
  conteudo: RoteiroConteudo
  texto: string | null
  status: 'rascunho' | 'gravado' | string
  modelo: string | null
  createdAt: number
  textoPadrao: string
}

export interface IdeiaDetalhe {
  id: string
  personaId: string
  semana: string
  tipo: string
  titulo: string
  porQue: string | null
  angulo: string | null
  hook: string | null
  formato: string | null
  status: string
  motivo: string | null
  nota: string | null
  createdAt: number
  assunto: PostDetalhe | null
  formatoRef: PostDetalhe | null
  exemplos: PostDetalhe[]
  pergunta: string | null
  roteiros: Roteiro[]
  roteiroApi: boolean
}

export interface Job {
  cmd: string
  rotulo: string
  inicio: number
  fim: number | null
  codigo: number | null
  saida: string[]
  rodando: boolean
  parado?: boolean
  retomar: string | null
  personaId?: string | null
}

export interface TemaItem {
  tema: string
  detalhe: string
}

export interface Territorio {
  resumo: string
  publico: string
  temas: TemaItem[]
  pessoal: TemaItem[]
  opinioes: string[]
  historias: string[]
  tom: string
  formatos: string[]
  fora: string[]
}

export interface PersonaCompleta extends PersonaResumo {
  publico: string | null
  entrevista?: Record<string, string>
  territorio?: Territorio | null
  territorioVersao?: number
}

export interface Semente {
  username: string
  status: 'confirmada' | 'sugerida' | 'rejeitada' | string
  origem: string | null
  motivo: string | null
  fullName: string | null
  bio: string | null
  followingCount: number | null
  privada: boolean | null
  coletadaEm: number | null
  tentativaEm: number | null
  erro: string | null
  contas: number
}

export interface Referencia {
  username: string
  status: 'ativa' | 'pausada' | 'sugerida' | string
  origem: string | null
  motivo: string | null
  fullName: string | null
  bio: string | null
  followers: number | null
  lastWatchedAt: number | null
  posts: number
  dentro: number
}

export interface ContaGrafo {
  username: string
  sementes: number
  papel: string
  source: string
  confianca: number | null
  motivo: string | null
  tema: string | null
  candidataSemente: boolean
  fullName: string | null
  bio: string | null
  category: string | null
  followers: number | null
  lastWatchedAt: number | null
  posts: number
}

export interface CreatorDados {
  personas: PersonaResumo[]
  persona: PersonaCompleta | null
  perguntas?: { chave: string; pergunta: string }[]
  api?: { chave: boolean; modelo: string; modeloPauta: string }
  semanas?: string[]
  semana?: string
  visao?: 'dia' | 'semana'
  dia?: string
  hoje?: string
  dias?: string[]
  ideias?: Ideia[]
  motivosRecusa?: Record<string, string>
  sementes?: Semente[]
  referencias?: Referencia[]
  grafo?: ContaGrafo[]
  /** quantas sementes uma conta precisa ter para entrar no grafo */
  minimo?: number
  melhores?: { dentro: Melhor[]; radar: Melhor[] }
  funil?: Record<string, number>
  [extra: string]: unknown
}

type Verbo = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
const e = encodeURIComponent

/** Fala com a API REST (/api/...). O token do login vai pelo interceptor; a documentacao fica em /docs. */
@Injectable({ providedIn: 'root' })
export class Api {
  private readonly http = inject(HttpClient)

  private async pedir<T>(verbo: Verbo, url: string, corpo?: unknown, params?: Record<string, string>): Promise<T> {
    try {
      return await firstValueFrom(this.http.request<T>(verbo, url, { body: corpo, params }))
    } catch (err) {
      if (err instanceof HttpErrorResponse) throw new Error((err.error as { erro?: string } | null)?.erro ?? `o servidor respondeu ${err.status}`)
      throw err
    }
  }

  /** tudo de um creator; sem persona, o que essa pessoa esta vendo */
  creator(params: { persona?: string | null; semana?: string | null; visao?: 'dia' | 'semana'; dia?: string | null } = {}): Promise<CreatorDados> {
    const q: Record<string, string> = {}
    for (const [k, v] of Object.entries(params)) if (v && k !== 'persona') q[k] = v
    return this.pedir('GET', `/api/creators/${e(params.persona || 'atual')}`, undefined, q)
  }

  ideia(id: string): Promise<IdeiaDetalhe> {
    return this.pedir('GET', `/api/ideias/${e(id)}`)
  }

  job(): Promise<{ job: Job | null }> {
    return this.pedir('GET', '/api/etapas')
  }

  /** inicia (cmd), para (parar) ou continua (retomar) uma etapa */
  mandarJob(corpo: { cmd?: string; conta?: string; minimo?: number | null; parar?: boolean; retomar?: boolean; persona?: string | null }): Promise<{ ok: boolean; erro?: string }> {
    if (corpo.parar) return this.pedir('POST', '/api/etapas/parar', {})
    if (corpo.retomar) return this.pedir('POST', '/api/etapas/continuar', { persona: corpo.persona ?? undefined })
    return this.pedir('POST', '/api/etapas', { cmd: corpo.cmd, conta: corpo.conta, minimo: corpo.minimo ?? null, persona: corpo.persona ?? undefined })
  }

  /** Quem esta logado: papel e creators liberados (null = todos). */
  eu(): Promise<Eu> {
    return this.pedir('GET', '/api/eu')
  }

  // ---- administracao (so admin) ----

  usuarios(): Promise<{ usuarios: UsuarioAdmin[]; personas: PersonaCurta[] }> {
    return this.pedir('GET', '/api/admin/usuarios')
  }

  criarUsuario(dados: { email: string; senha: string; nome?: string; papel: Papel; personas: string[] }): Promise<{ ok: boolean; usuario: UsuarioAdmin }> {
    return this.pedir('POST', '/api/admin/usuarios', dados)
  }

  editarUsuario(id: string, dados: { nome?: string | null; papel?: Papel; ativo?: boolean; senha?: string; personas?: string[] }): Promise<{ ok: boolean }> {
    return this.pedir('PATCH', `/api/admin/usuarios/${e(id)}`, dados)
  }

  /**
   * Os comandos das telas (ideia.responder, semente.status, roteiro.gerar...)
   * e a rota REST de cada um. Num lugar so: as telas nao sabem de URL.
   */
  acao<T = Record<string, unknown>>(acao: string, persona: string | null | undefined, d: Record<string, unknown> = {}): Promise<T> {
    const c = `/api/creators/${e(String(d['persona'] ?? persona ?? 'atual'))}`
    const ideia = `/api/ideias/${e(String(d['id'] ?? ''))}`
    const roteiro = `/api/roteiros/${e(String(d['roteiro'] ?? ''))}`
    const u = e(String(d['username'] ?? ''))
    switch (acao) {
      case 'persona.criar':
        return this.pedir('POST', '/api/creators', { nome: d['nome'], handle: d['handle'] || null })
      case 'persona.ativar':
        return this.pedir('POST', `/api/creators/${e(String(persona ?? ''))}/escolher`, {})
      case 'persona.salvar':
        return this.pedir('PATCH', c, { nome: d['nome'], handle: d['handle'] ?? null, entrevista: d['entrevista'] })
      case 'territorio.salvar':
        return this.pedir('PUT', `${c}/territorio`, { territorio: d['territorio'] })
      case 'sementes.add':
        return this.pedir('POST', `${c}/sementes`, { texto: d['texto'] })
      case 'semente.status':
        return this.pedir('PATCH', `${c}/sementes/${u}`, { status: d['status'] })
      case 'referencias.add':
        return this.pedir('POST', `${c}/referencias`, { texto: d['texto'] })
      case 'referencia.status':
        return this.pedir('PATCH', `${c}/referencias/${u}`, { status: d['status'] })
      case 'conta.papel':
        return this.pedir('PATCH', `${c}/contas/${u}`, { papel: d['papel'] ?? null })
      case 'encaixe.corrigir':
        return this.pedir('PATCH', `${c}/encaixes/${e(String(d['shortcode'] ?? ''))}`, { valor: d['valor'] ?? null, radarTema: d['radarTema'] ?? null })
      case 'ideia.responder':
        return this.pedir('POST', `${ideia}/resposta`, { status: d['status'], motivo: d['motivo'] || undefined, nota: d['nota'] || undefined })
      case 'radar.adotar':
        return this.pedir('POST', `${ideia}/adotar`, { como: d['como'], detalhe: d['detalhe'] || undefined })
      case 'radar.dispensar':
        return this.pedir('POST', `${ideia}/dispensar`, {})
      case 'roteiro.gerar':
        return this.pedir('POST', `${ideia}/roteiros`, { resposta: d['resposta'] || undefined, pedido: d['pedido'] || undefined })
      case 'roteiro.prompt':
        return this.pedir('POST', `${ideia}/roteiros/prompt`, { resposta: d['resposta'] || undefined, pedido: d['pedido'] || undefined })
      case 'roteiro.colar':
        return this.pedir('POST', `${ideia}/roteiros/manual`, { resposta: d['resposta'] || undefined, texto: d['texto'] })
      case 'roteiro.apagar':
        return this.pedir('DELETE', `${ideia}/roteiros`)
      case 'roteiro.salvar':
        return this.pedir('POST', `${ideia}/roteiros/${e(String(d['roteiro'] ?? ''))}/edicao`, { conteudo: d['conteudo'] })
      case 'roteiro.status':
        return this.pedir('PATCH', roteiro, { status: d['status'] })
      case 'roteiro.editar':
        return this.pedir('PATCH', roteiro, { texto: d['texto'] })
      default:
        return Promise.reject(new Error(`comando desconhecido: ${acao}`))
    }
  }
}
