import { Component, computed, inject } from '@angular/core'
import { DatePipe } from '@angular/common'
import { MatButtonModule } from '@angular/material/button'
import { MatIconModule } from '@angular/material/icon'
import { MatProgressBarModule } from '@angular/material/progress-bar'
import { Estado } from '../core/estado'

/**
 * Primeira versao da Pauta no Angular: a lista de ideias da semana, para provar
 * o caminho login -> API -> Postgres. O detalhe, o roteiro e as acoes vem a seguir.
 */
@Component({
  selector: 'app-pauta',
  imports: [DatePipe, MatButtonModule, MatIconModule, MatProgressBarModule],
  template: `
    @if (estado.carregando()) { <mat-progress-bar mode="indeterminate" class="mb-4" /> }

    @if (estado.dados(); as d) {
      <div class="mb-5 flex flex-wrap items-center gap-3">
        <span class="text-sm text-apagado">Semana {{ d.semana }}</span>
        <span class="flex-1"></span>
        <span class="text-sm text-apagado">{{ pauta().length }} ideias · {{ radar().length }} temas no radar</span>
      </div>

      @if (!pauta().length) {
        <div class="rounded-xl border border-dashed border-linha p-10 text-center text-apagado">Nenhuma ideia nesta semana ainda.</div>
      }

      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        @for (i of pauta(); track i.id) {
          <article class="flex flex-col gap-2 rounded-xl border border-linha bg-cartao p-5 transition-shadow hover:shadow-md">
            <h2 class="m-0 text-[17px] font-semibold leading-snug">{{ i.titulo }}</h2>
            @if (i.hook) { <p class="m-0 text-sm italic text-apagado">“{{ i.hook }}”</p> }
            <div class="mt-auto flex flex-wrap items-center gap-2 pt-2 text-xs text-apagado">
              @if (i.posts[0]; as p) { <span>&#64;{{ p.autor }}</span> · }
              <span>{{ i.createdAt * 1000 | date: 'dd/MM HH:mm' }}</span>
              @if (i.status !== 'nova') { <span class="rounded-full bg-marca-suave px-2 py-0.5 text-marca">{{ i.status }}</span> }
              @if (i.roteiros) { <span class="flex items-center gap-1"><mat-icon class="!size-4 !text-[16px]">description</mat-icon>{{ i.roteiros }}</span> }
            </div>
          </article>
        }
      </div>
    }
  `,
})
export class Pauta {
  protected readonly estado = inject(Estado)
  protected readonly pauta = computed(() => (this.estado.dados()?.ideias ?? []).filter((i) => i.tipo === 'pauta'))
  protected readonly radar = computed(() => (this.estado.dados()?.ideias ?? []).filter((i) => i.tipo === 'radar'))
}
