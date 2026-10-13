import { Component, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core'
import { MatButtonModule } from '@angular/material/button'
import { MatIconModule } from '@angular/material/icon'
import { MatTooltipModule } from '@angular/material/tooltip'
import { Execucao } from '../core/execucao'

/**
 * Caixinha do log no canto, como uma janela de mensagens: aberta mostra o log,
 * minimizada fica so o nome da etapa, fechada some ate a proxima etapa.
 */
@Component({
  selector: 'app-log',
  imports: [MatButtonModule, MatIconModule, MatTooltipModule],
  host: { '(document:keydown.escape)': 'ex.grande() && ex.alternarGrande()' },
  template: `
    @if (ex.job(); as j) {
      @if (ex.log() !== 'oculto') {
        @if (ex.log() === 'aberto') {
          <section
            class="fixed z-40 flex flex-col overflow-hidden rounded-xl border border-linha bg-cartao shadow-2xl"
            [class]="ex.grande() ? 'inset-4 md:inset-10' : 'bottom-4 right-4 left-4 h-80 md:left-auto md:w-[460px]'"
            role="status">
            <header class="flex items-center gap-2 border-b border-linha px-3 py-2">
              <span class="size-2.5 shrink-0 rounded-full" [class]="cor()"></span>
              <div class="min-w-0 flex-1">
                <b class="block truncate text-sm">{{ j.rotulo }}</b>
                <span class="text-xs text-apagado">{{ situacao() }}</span>
              </div>
              @if (j.rodando) {
                <button mat-button (click)="ex.parar()">Parar</button>
              } @else if (j.retomar) {
                <button mat-stroked-button (click)="ex.continuar()" [matTooltip]="j.retomar">Continuar</button>
              }
              <button mat-icon-button (click)="ex.alternarGrande()" [attr.aria-label]="ex.grande() ? 'Diminuir' : 'Expandir'">
                <mat-icon>{{ ex.grande() ? 'close_fullscreen' : 'open_in_full' }}</mat-icon>
              </button>
              <button mat-icon-button (click)="ex.mostrarLog('min')" aria-label="Minimizar"><mat-icon>remove</mat-icon></button>
              @if (!j.rodando) {
                <button mat-icon-button (click)="ex.mostrarLog('oculto')" aria-label="Fechar"><mat-icon>close</mat-icon></button>
              }
            </header>
            <pre #pre (scroll)="noFim.set(estaNoFim())"
                 class="m-0 flex-1 overflow-auto bg-[#15172b] p-3 font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-[#e4e5ee]">{{ j.saida.join('\\n') || 'Esperando a primeira linha…' }}</pre>
          </section>
        } @else {
          <div class="fixed right-4 bottom-4 z-40 flex items-center gap-1 rounded-full border border-linha bg-cartao py-1 pr-1 pl-3 shadow-lg">
            <button class="flex max-w-72 items-center gap-2 border-0 bg-transparent py-1 text-left text-sm" (click)="ex.mostrarLog('aberto')" title="Ver o log">
              <span class="size-2.5 shrink-0 rounded-full" [class]="cor()"></span>
              <b class="truncate">{{ j.rotulo }}</b>
              <span class="shrink-0 text-xs text-apagado">{{ situacao() }}</span>
              <mat-icon class="!size-4 !text-[16px]">expand_less</mat-icon>
            </button>
            @if (!j.rodando && j.retomar) { <button mat-button (click)="ex.continuar()" [matTooltip]="j.retomar">Continuar</button> }
            @if (j.rodando) {
              <button mat-icon-button (click)="ex.parar()" aria-label="Parar a etapa" matTooltip="Parar"><mat-icon>stop</mat-icon></button>
            } @else {
              <button mat-icon-button (click)="ex.mostrarLog('oculto')" aria-label="Fechar"><mat-icon>close</mat-icon></button>
            }
          </div>
        }
      }
    }
  `,
})
export class Log {
  protected readonly ex = inject(Execucao)
  private readonly pre = viewChild<ElementRef<HTMLPreElement>>('pre')
  protected readonly noFim = signal(true)
  private readonly agora = signal(Date.now())

  protected readonly cor = computed(() => {
    const j = this.ex.job()
    if (!j) return ''
    return j.rodando ? 'bg-amber-500 animate-pulse' : j.codigo === 0 ? 'bg-emerald-500' : j.parado ? 'bg-slate-400' : 'bg-red-500'
  })

  protected readonly situacao = computed(() => {
    const j = this.ex.job()
    if (!j) return ''
    const s = Math.max(0, Math.round(((j.fim ?? this.agora()) - j.inicio) / 1000))
    const dur = s < 60 ? `${s}s` : `${Math.floor(s / 60)}min ${String(s % 60).padStart(2, '0')}s`
    return j.rodando ? `rodando · ${dur}` : j.parado ? `parado · ${dur}` : `${j.codigo === 0 ? 'terminou' : 'falhou'} · ${dur}`
  })

  constructor() {
    setInterval(() => this.ex.rodando() && this.agora.set(Date.now()), 1000)
    // log novo: rola para o fim, a nao ser que voce tenha subido para ler
    effect(() => {
      this.ex.job()
      const el = this.pre()?.nativeElement
      if (el && this.noFim()) queueMicrotask(() => (el.scrollTop = el.scrollHeight))
    })
  }

  protected estaNoFim(): boolean {
    const el = this.pre()?.nativeElement
    return !el || el.scrollTop + el.clientHeight >= el.scrollHeight - 20
  }
}
