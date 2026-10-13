import { Injectable, computed, inject, signal } from '@angular/core'
import { Api, type CreatorDados, type Eu } from './api'

/**
 * Os dados do creator escolhido, compartilhados entre as telas. Cada tela pede
 * `carregar()` com o que precisa (semana, visao); a troca de creator recarrega.
 */
@Injectable({ providedIn: 'root' })
export class Estado {
  private readonly api = inject(Api)

  readonly dados = signal<CreatorDados | null>(null)
  readonly carregando = signal(false)
  readonly erro = signal<string | null>(null)
  readonly persona = computed(() => this.dados()?.persona ?? null)
  readonly personas = computed(() => this.dados()?.personas ?? [])
  readonly eu = signal<Eu | null>(null)
  readonly admin = computed(() => this.eu()?.papel === 'admin')

  async carregarEu(): Promise<void> {
    try {
      this.eu.set(await this.api.eu())
    } catch (e) {
      this.erro.set((e as Error).message)
    }
  }

  private filtro: { semana?: string | null; visao?: 'dia' | 'semana'; dia?: string | null } = {}

  async carregar(filtro?: { semana?: string | null; visao?: 'dia' | 'semana'; dia?: string | null }): Promise<void> {
    if (filtro) this.filtro = { ...this.filtro, ...filtro }
    this.carregando.set(true)
    this.erro.set(null)
    try {
      this.dados.set(await this.api.creator({ persona: this.persona()?.id, ...this.filtro }))
    } catch (e) {
      this.erro.set((e as Error).message)
    } finally {
      this.carregando.set(false)
    }
  }

  /** O creator escolhido vira o ativo (coleta, ciclo e pauta passam a ser dele). */
  async trocarPersona(id: string): Promise<void> {
    await this.api.acao('persona.ativar', id)
    this.dados.update((d) => (d ? { ...d, persona: d.personas.find((p) => p.id === id) as CreatorDados['persona'] } : d))
    await this.carregar()
  }
}
