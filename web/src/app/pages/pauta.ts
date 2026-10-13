import { Component, computed, inject, signal } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { MatButtonModule } from '@angular/material/button'
import { MatButtonToggleModule } from '@angular/material/button-toggle'
import { MatDialog } from '@angular/material/dialog'
import { MatExpansionModule } from '@angular/material/expansion'
import { MatIconModule } from '@angular/material/icon'
import { MatProgressBarModule } from '@angular/material/progress-bar'
import { MatSelectModule } from '@angular/material/select'
import { MatSnackBar } from '@angular/material/snack-bar'
import { MatTooltipModule } from '@angular/material/tooltip'
import type { Ideia, Melhor, PostMini } from '../core/api'
import { Estado } from '../core/estado'
import { ENCAIXE, ehVideo, guardado, horaDe, linkPerfil, linkPost, nomeDia, nomeFormato, rotuloSemana } from '../core/formato'
import { Detalhe, type DadosDetalhe } from '../pauta/detalhe'
import { Respostas } from '../pauta/respostas'

type Visao = 'dia' | 'semana'

/** A pauta: ideias do dia (ou da semana), o radar e os posts que o sinal apontou. */
@Component({
  selector: 'app-pauta',
  imports: [FormsModule, MatButtonModule, MatButtonToggleModule, MatExpansionModule, MatIconModule, MatProgressBarModule, MatSelectModule, MatTooltipModule, Respostas],
  template: `
    @if (estado.carregando()) { <mat-progress-bar mode="indeterminate" class="!fixed top-0 right-0 left-0 z-50" /> }

    @if (estado.dados(); as d) {
      @if (!d.persona) {
        <div class="rounded-xl border border-dashed border-linha p-10 text-center text-apagado">Nenhum creator ainda. Crie o seu no menu de creators, no topo.</div>
      } @else {
        <div class="mb-5 flex flex-wrap items-center gap-3">
          <h2 class="m-0 flex-1 text-[22px] font-bold">{{ titulo() }}</h2>
          <mat-button-toggle-group [value]="visao()" (change)="trocarVisao($event.value)" hideSingleSelectionIndicator aria-label="Ver por">
            <mat-button-toggle value="dia">Por dia</mat-button-toggle>
            <mat-button-toggle value="semana">Por semana</mat-button-toggle>
          </mat-button-toggle-group>
          <mat-form-field appearance="outline" subscriptSizing="dynamic" class="campo-compacto w-52">
            @if (visao() === 'dia') {
              <mat-select [value]="d.dia" (selectionChange)="estado.carregar({ dia: $event.value })" aria-label="Dia">
                @for (x of d.dias ?? []; track x) { <mat-option [value]="x">{{ nomeDia(x, d.hoje) }}</mat-option> }
              </mat-select>
            } @else {
              <mat-select [value]="d.semana" (selectionChange)="estado.carregar({ semana: $event.value })" aria-label="Semana">
                @for (x of d.semanas ?? []; track x) { <mat-option [value]="x">{{ rotuloSemana(x) }}</mat-option> }
              </mat-select>
            }
          </mat-form-field>
        </div>

        @if (!d.persona.temTerritorio) {
          <div class="mb-5 rounded-xl border border-amber-300 bg-amber-50 p-5"><b>Falta o território.</b> Responda a entrevista na aba Creator e gere o território antes da primeira pauta.</div>
        }

        @if (pauta().length) {
          <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            @for (i of pauta(); track i.id) {
              <article class="group flex cursor-pointer flex-col overflow-hidden rounded-xl border border-linha bg-cartao transition-shadow hover:shadow-md"
                       [class.opacity-60]="i.status === 'recusada'" tabindex="0" (click)="abrir(i, false, $event)" (keydown.enter)="abrir(i)">
                @if (i.posts[0]; as p) {
                  <div class="relative aspect-[4/3] overflow-hidden bg-black/5">
                    @if (p.thumb) { <img [src]="p.thumb" alt="" loading="lazy" class="size-full object-cover" /> }
                    @else { <p class="m-0 p-4 text-sm text-apagado">{{ p.legenda.slice(0, 120) }}</p> }
                    @if (ehVideo(p.tipo)) { <span class="absolute top-2 left-2 grid size-7 place-items-center rounded-full bg-black/60 text-white"><mat-icon class="!size-4 !text-[16px]">play_arrow</mat-icon></span> }
                    <a [href]="linkPost(p.shortcode)" target="_blank" rel="noopener" (click)="$event.stopPropagation()" matTooltip="Abrir o post no Instagram"
                       class="absolute top-2 right-2 grid size-8 place-items-center rounded-full bg-white/85 text-tinta opacity-0 shadow transition-opacity group-hover:opacity-100">
                      <mat-icon class="!size-4 !text-[18px]">open_in_new</mat-icon>
                    </a>
                  </div>
                }
                <div class="flex flex-1 flex-col gap-2 p-4">
                  <h3 class="m-0 text-[16px] leading-snug font-semibold">{{ i.titulo }}</h3>
                  <div class="flex flex-wrap items-center gap-x-2 text-[13px] text-apagado">
                    @for (m of meta(i); track $index) { @if ($index) { <span>·</span> } <span>{{ m }}</span> }
                  </div>
                  <div class="mt-auto flex flex-wrap items-center gap-2 pt-2" (click)="$event.stopPropagation()">
                    <app-respostas [id]="i.id" [status]="i.status" [motivo]="i.motivo" [notaAtual]="i.nota" />
                    @if (i.status !== 'recusada') {
                      <button mat-button class="!h-8" (click)="abrir(i, true)"><mat-icon>description</mat-icon>{{ i.roteiros ? 'Roteiro (v' + i.roteiros + ')' : 'Roteiro' }}</button>
                    }
                  </div>
                </div>
              </article>
            }
          </div>
        } @else if (d.persona.temTerritorio) {
          <div class="rounded-xl border border-dashed border-linha p-10 text-center">
            <b class="block">{{ vazio() }}</b>
            <span class="text-sm text-apagado">Clique em “Buscar ideias” no topo. Se já rodou, veja o log para saber em que etapa parou.</span>
          </div>
        }

        @if (radar().length) {
          <h2 class="m-0 mt-10 mb-1 text-[18px] font-bold">Radar@if (visao() === 'dia') { da semana de {{ rotuloSemana(d.semana) }}}</h2>
          <p class="m-0 mb-4 text-sm text-apagado">O público consome, mas não está no seu território. É só dica.</p>
          <div class="grid gap-4 md:grid-cols-2">
            @for (r of radar(); track r.id) {
              <article class="flex cursor-pointer flex-col gap-3 rounded-xl border border-linha bg-cartao p-4 hover:shadow-md" tabindex="0" (click)="abrir(r, false, $event)" (keydown.enter)="abrir(r)">
                <h3 class="m-0 text-[16px] font-semibold">{{ r.titulo }}</h3>
                @if (r.porQue) { <p class="m-0 text-sm text-apagado">{{ r.porQue }}</p> }
                <div class="flex gap-2">
                  @for (p of r.posts.slice(0, 4); track p.shortcode) {
                    <a [href]="linkPost(p.shortcode)" target="_blank" rel="noopener" (click)="$event.stopPropagation()" class="block size-16 overflow-hidden rounded-md bg-black/5">
                      @if (p.thumb) { <img [src]="p.thumb" alt="" loading="lazy" class="size-full object-cover" /> }
                    </a>
                  }
                </div>
                <div class="flex flex-wrap gap-2 text-[13px]">
                  @for (u of autores(r.posts); track u) { <a [href]="linkPerfil(u)" target="_blank" rel="noopener" (click)="$event.stopPropagation()" class="text-apagado">&#64;{{ u }}</a> }
                </div>
                <div (click)="$event.stopPropagation()"><app-respostas [id]="r.id" tipo="radar" [status]="r.status" [comDetalhe]="true" /></div>
              </article>
            }
          </div>
        }

        @if (d.melhores; as m) {
          <mat-accordion class="mt-10 block">
            <mat-expansion-panel class="!rounded-xl !shadow-none !border !border-linha">
              <mat-expansion-panel-header>
                <mat-panel-title>Posts que o sinal apontou ({{ m.dentro.length }} dentro, {{ m.radar.length }} radar)</mat-panel-title>
                <mat-panel-description class="!hidden md:!flex">revise a avaliação da IA</mat-panel-description>
              </mat-expansion-panel-header>
              @for (grupo of [{ tipo: 'dentro', xs: m.dentro }, { tipo: 'radar', xs: m.radar }]; track grupo.tipo) {
                <h3 class="m-0 mt-2 mb-2 text-[15px] font-semibold">{{ grupo.tipo === 'dentro' ? 'Dentro do território' : 'Radar' }}</h3>
                @for (x of grupo.xs; track x.shortcode) {
                  <div class="flex flex-wrap items-start gap-3 border-t border-linha py-3 md:flex-nowrap">
                    <a [href]="linkPost(x.shortcode)" target="_blank" rel="noopener" class="block size-14 shrink-0 overflow-hidden rounded-md bg-black/5">
                      @if (x.thumb) { <img [src]="x.thumb" alt="" loading="lazy" class="size-full object-cover" /> }
                    </a>
                    <div class="min-w-0 flex-1 text-[13px]">
                      <a [href]="linkPerfil(x.autor)" target="_blank" rel="noopener" class="font-semibold text-tinta">&#64;{{ x.autor }}</a>
                      <p class="m-0 line-clamp-2 text-apagado">{{ x.legenda }}</p>
                    </div>
                    <div class="min-w-0 flex-1 text-[13px]">
                      @if (grupo.tipo === 'dentro') { <b>{{ x.temaTerritorio || x.tema }}</b><p class="m-0 text-apagado">{{ x.angulo }}</p> }
                      @else { <b>{{ x.radarTema }}</b> }
                      <p class="m-0 text-apagado">{{ x.porQue }}</p>
                    </div>
                    <div class="flex w-full shrink-0 flex-col gap-1 md:w-44">
                      <mat-form-field appearance="outline" subscriptSizing="dynamic" class="campo-compacto">
                        <mat-select [value]="''" (selectionChange)="corrigir(x, $event.value)" aria-label="Encaixe">
                          <mat-option value="">(IA) {{ ENCAIXE[grupo.tipo] }}</mat-option>
                          @for (e of encaixes; track e[0]) { <mat-option [value]="e[0]">{{ e[1] }}</mat-option> }
                        </mat-select>
                      </mat-form-field>
                      @if (temaPara() === x.shortcode) {
                        <input #tema placeholder="Tema do radar (ex.: corrida)" class="rounded-md border border-linha bg-white px-2 py-1.5 text-sm"
                               (keydown.enter)="corrigir(x, 'radar', tema.value)" (keydown.escape)="temaPara.set(null)" />
                        <button mat-button class="!h-7 self-end" (click)="corrigir(x, 'radar', tema.value)">salvar</button>
                      }
                    </div>
                  </div>
                } @empty {
                  <p class="m-0 mb-3 text-sm text-apagado">Nenhum post {{ grupo.tipo === 'dentro' ? 'dentro do território' : 'no radar' }} ainda.</p>
                }
              }
            </mat-expansion-panel>
          </mat-accordion>
        }
      }
    }
  `,
})
export class Pauta {
  protected readonly estado = inject(Estado)
  private readonly dialogo = inject(MatDialog)
  private readonly avisos = inject(MatSnackBar)

  protected readonly visao = signal<Visao>((guardado.ler('cx-visao') as Visao) || 'dia')
  protected readonly temaPara = signal<string | null>(null)
  protected readonly pauta = computed(() => (this.estado.dados()?.ideias ?? []).filter((i) => i.tipo === 'pauta'))
  protected readonly radar = computed(() => (this.estado.dados()?.ideias ?? []).filter((i) => i.tipo === 'radar'))

  protected readonly ENCAIXE = ENCAIXE
  protected readonly encaixes = Object.entries(ENCAIXE)
  protected readonly rotuloSemana = rotuloSemana
  protected readonly nomeDia = nomeDia
  protected readonly linkPost = linkPost
  protected readonly linkPerfil = linkPerfil
  protected readonly ehVideo = ehVideo

  protected readonly titulo = computed(() => {
    const d = this.estado.dados()
    if (this.visao() === 'semana') return 'Pauta da semana'
    const n = nomeDia(d?.dia, d?.hoje)
    return n === 'Hoje' || n === 'Ontem' ? `Sugeridas ${n.toLowerCase()}` : `Sugeridas em ${n}`
  })

  protected readonly vazio = computed(() => {
    const d = this.estado.dados()
    if (this.visao() === 'semana') return `Sem pauta na semana de ${rotuloSemana(d?.semana)}`
    const n = nomeDia(d?.dia, d?.hoje)
    return n === 'Hoje' || n === 'Ontem' ? `Nenhuma ideia ${n.toLowerCase()}` : `Nenhuma ideia em ${n}`
  })

  constructor() {
    void this.estado.carregar({ visao: this.visao() })
  }

  protected trocarVisao(v: Visao): void {
    this.visao.set(v)
    guardado.gravar('cx-visao', v)
    void this.estado.carregar({ visao: v })
  }

  protected meta(i: Ideia): string[] {
    const d = this.estado.dados()
    const p = i.posts[0]
    const quando = this.visao() === 'dia' ? horaDe(i.createdAt) : `${nomeDia(new Date(i.createdAt * 1000).toLocaleDateString('sv-SE'), d?.hoje)} ${horaDe(i.createdAt)}`
    return [nomeFormato(i.formato), p ? `ref. @${p.autor}` : '', i.createdAt ? quando : ''].filter(Boolean)
  }

  protected autores(ps: PostMini[]): string[] {
    return [...new Set(ps.map((p) => p.autor))]
  }

  /** abre o detalhe; clique em botao ou link do card nao abre */
  protected abrir(i: Ideia, irRoteiro = false, ev?: Event): void {
    if (ev && (ev.target as HTMLElement).closest('button, a, input, select, textarea, mat-select')) return
    this.dialogo.open<Detalhe, DadosDetalhe>(Detalhe, {
      data: { id: i.id, irRoteiro },
      width: '1040px',
      maxWidth: '96vw',
      autoFocus: false,
      panelClass: 'detalhe-painel',
    })
  }

  protected async corrigir(x: Melhor, valor: string, tema?: string): Promise<void> {
    if (valor === 'radar' && tema === undefined) {
      this.temaPara.set(x.shortcode)
      return
    }
    if (valor === 'radar' && !tema?.trim()) return
    this.temaPara.set(null)
    try {
      await this.estado.acao('encaixe.corrigir', { shortcode: x.shortcode, valor: valor || null, radarTema: tema?.trim() || null })
      this.avisos.open('Avaliação corrigida.', 'OK', { duration: 3000 })
    } catch (e) {
      this.avisos.open((e as Error).message, 'OK', { duration: 6000 })
    }
  }
}
