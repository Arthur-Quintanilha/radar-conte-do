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
  id: string
  shortcode: string
  autor: string
  tipo: string | null
  legenda: string
  thumb: string | null
  [extra: string]: unknown
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

export interface Eu {
  id: string
  email: string
  papel: 'admin' | 'membro'
  local: boolean
  personas: string[] | null
}

/** O que GET /api/creator devolve (so os campos que as telas usam por enquanto). */
export interface CreatorDados {
  personas: PersonaResumo[]
  persona: (PersonaResumo & { publico: string | null }) | null
  semanas?: string[]
  semana?: string
  visao?: 'dia' | 'semana'
  dia?: string
  hoje?: string
  dias?: string[]
  ideias?: Ideia[]
  funil?: Record<string, number>
  [extra: string]: unknown
}

/** Fala com a nossa API (/api/creator/...). O token do login vai pelo interceptor. */
@Injectable({ providedIn: 'root' })
export class Api {
  private readonly http = inject(HttpClient)

  private async pedir<T>(p: Promise<T>): Promise<T> {
    try {
      return await p
    } catch (e) {
      if (e instanceof HttpErrorResponse) throw new Error((e.error as { erro?: string } | null)?.erro ?? `o servidor respondeu ${e.status}`)
      throw e
    }
  }

  creator(params: { persona?: string | null; semana?: string | null; visao?: 'dia' | 'semana'; dia?: string | null } = {}): Promise<CreatorDados> {
    const q: Record<string, string> = {}
    for (const [k, v] of Object.entries(params)) if (v) q[k] = v
    return this.pedir(firstValueFrom(this.http.get<CreatorDados>('/api/creator', { params: q })))
  }

  ideia(id: string): Promise<Record<string, unknown>> {
    return this.pedir(firstValueFrom(this.http.get<Record<string, unknown>>('/api/creator/ideia', { params: { id } })))
  }

  /** Quem esta logado: papel e creators liberados (null = todos). */
  eu(): Promise<Eu> {
    return this.pedir(firstValueFrom(this.http.get<Eu>('/api/eu')))
  }

  /** As mesmas acoes do painel antigo: ideia.responder, semente.status, territorio.salvar... */
  acao<T = Record<string, unknown>>(acao: string, persona: string | null | undefined, dados: Record<string, unknown> = {}): Promise<T> {
    return this.pedir(firstValueFrom(this.http.post<T>('/api/creator/acao', { acao, persona, ...dados })))
  }
}
