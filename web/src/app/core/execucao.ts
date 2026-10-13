import { Injectable, computed, inject, signal } from '@angular/core'
import { MatSnackBar } from '@angular/material/snack-bar'
import { Api, type Job } from './api'
import { Estado } from './estado'
import { guardado } from './formato'

export type EstadoLog = 'aberto' | 'min' | 'oculto'

/** comandos que terminam gerando a pauta: aceitam um minimo de ideias */
const COM_PAUTA = new Set(['semana', 'semana-analise', 'pauta'])

export const ETAPAS: { cmd: string; rotulo: string; detalhe: string }[] = [
  { cmd: 'semana-analise', rotulo: 'Só a análise', detalhe: 'sem abrir o navegador' },
  { cmd: 'whisper', rotulo: 'Transcrever reels', detalhe: 'os da janela deste creator' },
  { cmd: 'encaixe', rotulo: 'Avaliar posts', detalhe: 'a IA confere o território' },
  { cmd: 'pauta', rotulo: 'Gerar mais ideias', detalhe: 'a partir dos posts já avaliados' },
]

/**
 * As etapas que o servidor roda (Buscar ideias, avaliar, transcrever...): uma
 * de cada vez. Acompanha o log enquanto roda e recarrega os dados no fim.
 */
@Injectable({ providedIn: 'root' })
export class Execucao {
  private readonly api = inject(Api)
  private readonly estado = inject(Estado)
  private readonly avisos = inject(MatSnackBar)

  readonly job = signal<Job | null>(null)
  readonly rodando = computed(() => Boolean(this.job()?.rodando))
  readonly log = signal<EstadoLog>((guardado.ler('cx-log') as EstadoLog) || 'min')
  readonly grande = signal(guardado.ler('cx-log-grande') === '1')
  /** minimo de ideias: vazio = a IA decide quantas saem */
  readonly minimo = signal<number | null>(Number(guardado.ler('cx-minimo')) || null)

  private timer: ReturnType<typeof setTimeout> | null = null

  constructor() {
    void this.atualizar()
  }

  mostrarLog(e: EstadoLog): void {
    this.log.set(e)
    guardado.gravar('cx-log', e)
  }

  alternarGrande(): void {
    this.grande.update((g) => !g)
    guardado.gravar('cx-log-grande', this.grande() ? '1' : '0')
  }

  definirMinimo(v: string | number | null): void {
    const n = Math.min(50, Math.floor(Number(v)))
    this.minimo.set(n > 0 ? n : null)
    guardado.gravar('cx-minimo', n > 0 ? String(n) : null)
  }

  async atualizar(): Promise<void> {
    if (this.timer) clearTimeout(this.timer)
    try {
      const antes = this.job()?.rodando
      const { job } = await this.api.job()
      this.job.set(job)
      if (job?.rodando) this.timer = setTimeout(() => void this.atualizar(), 1500)
      else if (antes && job) {
        await this.estado.carregar()
        const msg = job.parado
          ? `${job.rotulo}: parado${job.retomar ? '. Dá para continuar no log.' : ''}`
          : job.codigo === 0
            ? `${job.rotulo}: pronto`
            : `${job.rotulo}: terminou com erro (veja o log)`
        this.avisos.open(msg, 'OK', { duration: job.codigo === 0 || job.parado ? 4000 : 8000 })
      }
    } catch {
      // servidor fora do ar: tenta de novo depois
      if (this.rodando()) this.timer = setTimeout(() => void this.atualizar(), 4000)
    }
  }

  async rodar(cmd: string, conta?: string): Promise<void> {
    try {
      const minimo = COM_PAUTA.has(cmd) ? this.minimo() : null
      await this.api.mandarJob({ cmd, conta, minimo, persona: this.estado.persona()?.id })
      this.job.set({ cmd, rotulo: 'Iniciando…', inicio: Date.now(), fim: null, codigo: null, saida: [], rodando: true, retomar: null })
      // quem acabou de mandar rodar quer ver
      this.mostrarLog('aberto')
      this.timer = setTimeout(() => void this.atualizar(), 600)
    } catch (e) {
      this.avisos.open((e as Error).message, 'OK', { duration: 7000 })
    }
  }

  async parar(): Promise<void> {
    try {
      await this.api.mandarJob({ parar: true, persona: this.estado.persona()?.id })
    } catch (e) {
      this.avisos.open((e as Error).message, 'OK', { duration: 7000 })
    }
    await this.atualizar()
  }

  /** continua a ultima execucao parada: o ciclo volta pela etapa em que parou */
  async continuar(): Promise<void> {
    try {
      await this.api.mandarJob({ retomar: true, persona: this.estado.persona()?.id })
      const j = this.job()
      if (j) this.job.set({ ...j, rodando: true, parado: false, retomar: null, saida: [], inicio: Date.now(), fim: null })
      this.timer = setTimeout(() => void this.atualizar(), 600)
    } catch (e) {
      this.avisos.open((e as Error).message, 'OK', { duration: 7000 })
    }
  }
}
