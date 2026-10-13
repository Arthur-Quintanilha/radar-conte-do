import { Component, ElementRef, computed, input, output, signal, viewChild, afterNextRender } from '@angular/core'
import { MatButtonModule } from '@angular/material/button'
import { MatIconModule } from '@angular/material/icon'
import { MatTooltipModule } from '@angular/material/tooltip'
import type { PostDetalhe } from '../core/api'
import { ENCAIXE, TIPO_POST, dataLonga, ehVideo, linkPerfil, linkPost, numCurto, numInteiro, vezes } from '../core/formato'

/** Um post do Instagram no detalhe da ideia: midia com slides, autor, numeros, sinal, legenda e transcricao. */
@Component({
  selector: 'app-post-bloco',
  imports: [MatButtonModule, MatIconModule, MatTooltipModule],
  template: `
    @let p = post();
    <section class="border-t border-linha pt-5">
      <h3 class="m-0 mb-3 text-[15px] font-semibold text-apagado">{{ rotulo() }}</h3>
      <div class="grid gap-5 md:grid-cols-[minmax(0,320px)_1fr]">
        <!-- midia: fica parada enquanto o texto rola -->
        <div class="md:sticky md:top-0 md:self-start">
          @if (p.midias.length) {
            <div class="relative overflow-hidden rounded-lg bg-black">
              @for (m of p.midias; track $index) {
                @if ($index === slide()) {
                  @if (m.video) {
                    <video [src]="m.video" [poster]="m.imagem ?? ''" controls preload="metadata" class="block max-h-[70vh] w-full"></video>
                  } @else {
                    <img [src]="m.imagem" alt="" loading="lazy" class="block max-h-[70vh] w-full object-contain" />
                  }
                }
              }
              @if (p.midias.length > 1) {
                <button class="absolute top-1/2 left-2 grid size-8 -translate-y-1/2 place-items-center rounded-full border-0 bg-white/85 shadow" (click)="mover(-1)" aria-label="Anterior"><mat-icon>chevron_left</mat-icon></button>
                <button class="absolute top-1/2 right-2 grid size-8 -translate-y-1/2 place-items-center rounded-full border-0 bg-white/85 shadow" (click)="mover(1)" aria-label="Próximo"><mat-icon>chevron_right</mat-icon></button>
                <span class="absolute top-2 right-2 rounded-full bg-black/60 px-2 py-0.5 text-xs text-white">{{ slide() + 1 }}/{{ p.midias.length }}</span>
              }
            </div>
          } @else {
            <div class="grid aspect-square place-items-center rounded-lg bg-black/5 text-sm text-apagado">mídia não baixada</div>
          }
          <a [href]="linkPost(p.shortcode)" target="_blank" rel="noopener" class="mt-2 inline-flex items-center gap-1 text-sm text-marca">
            Abrir no Instagram <mat-icon class="!size-4 !text-[16px]">open_in_new</mat-icon>
          </a>
        </div>

        <div class="min-w-0 text-[14px] leading-relaxed">
          <div class="flex flex-wrap items-center gap-2">
            <a [href]="linkPerfil(p.autor)" target="_blank" rel="noopener" class="font-semibold text-tinta">&#64;{{ p.autor }}</a>
            @if (p.verificado) { <mat-icon class="!size-4 !text-[16px] text-marca" matTooltip="verificado">verified</mat-icon> }
            <button mat-button class="!h-7 !px-2 !text-xs" (click)="virarSemente.emit(p.autor)" matTooltip="Usar esta conta como semente">+ semente</button>
            <button mat-button class="!h-7 !px-2 !text-xs" (click)="virarReferencia.emit(p.autor)" matTooltip="Acompanhar como referência">+ referência</button>
          </div>
          <div class="text-[13px] text-apagado">{{ sobreAutor() }}</div>
          @if (p.autorBio) {
            <details class="mt-1 text-[13px] text-apagado"><summary class="cursor-pointer">bio</summary><p class="m-0 mt-1 whitespace-pre-line">{{ p.autorBio }}</p></details>
          }

          <div class="mt-3 flex flex-wrap gap-4">
            <span>@if (p.likes !== null) { <b>{{ numInteiro(p.likes) }}</b> curtidas } @else { curtidas ocultas }</span>
            @if (p.comments !== null) { <span><b>{{ numInteiro(p.comments) }}</b> comentários</span> }
            @if (p.plays) { <span><b>{{ numInteiro(p.plays) }}</b> views</span> }
          </div>
          <p class="m-0 mt-1 text-[13px] text-apagado">{{ info() }}</p>
          @if (sinal()) { <p class="m-0 mt-1 text-[13px] text-apagado"><b class="text-tinta">Sinal:</b> {{ sinal() }}</p> }
          @if (p.audio || p.local) {
            <p class="m-0 mt-1 text-[13px] text-apagado">
              @if (p.audio) { <b class="text-tinta">Áudio:</b> {{ p.audio }} }
              @if (p.audio && p.local) { · }
              @if (p.local) { <b class="text-tinta">Local:</b> {{ p.local }} }
            </p>
          }

          @if (p.encaixe; as e) {
            <div class="mt-3 rounded-lg bg-marca-suave px-3 py-2 text-[13px]">
              <b>Avaliação da IA:</b> {{ ENCAIXE[e.encaixe] ?? e.encaixe }}
              @if (e.tema) { · {{ e.tema }} }
              @if (e.temaTerritorio) { → {{ e.temaTerritorio }} }
              @if (e.confianca !== null) { · {{ pct(e.confianca) }} }
              @if (e.motivo) { <div class="text-apagado">{{ e.motivo }}</div> }
            </div>
          }

          <h4 class="m-0 mt-4 mb-1 text-[13px] font-semibold">Legenda</h4>
          @if (p.legenda) {
            <p #leg class="m-0 whitespace-pre-line" [class.line-clamp-6]="!legendaAberta()">{{ p.legenda }}</p>
            @if (legendaLonga()) {
              <button mat-button class="!h-7 !px-1 !text-xs" (click)="legendaAberta.set(!legendaAberta())">{{ legendaAberta() ? 'ver menos' : 'ver mais' }}</button>
            }
          } @else {
            <p class="m-0 text-apagado">Sem legenda.</p>
          }
          @if (p.hashtags.length) {
            <div class="mt-2 flex flex-wrap gap-1">
              @for (h of p.hashtags.slice(0, 20); track h) { <span class="rounded-full bg-black/5 px-2 py-0.5 text-xs">#{{ h }}</span> }
            </div>
          }

          @for (t of p.transcricoes; track $index) {
            <details class="mt-3 rounded-lg border border-linha px-3 py-2">
              <summary class="cursor-pointer text-[13px] font-semibold">Transcrição</summary>
              <p class="m-0 mt-2 whitespace-pre-line">{{ t.texto }}</p>
            </details>
          } @empty {
            @if (temVideo()) {
              <p class="m-0 mt-3 text-[13px] text-apagado">
                {{ p.semFala ? 'Vídeo transcrito: não tem fala (música ou silêncio).' : 'Vídeo ainda sem transcrição: ela sai na etapa de transcrever do ciclo.' }}
              </p>
            }
          }
          @if (p.alt) {
            <h4 class="m-0 mt-4 mb-1 text-[13px] font-semibold">Descrição automática da imagem</h4>
            <p class="m-0 text-apagado">{{ p.alt }}</p>
          }
        </div>
      </div>
    </section>
  `,
})
export class PostBloco {
  readonly post = input.required<PostDetalhe>()
  readonly rotulo = input('')
  readonly virarSemente = output<string>()
  readonly virarReferencia = output<string>()

  protected readonly slide = signal(0)
  protected readonly legendaAberta = signal(false)
  protected readonly legendaLonga = signal(false)
  private readonly leg = viewChild<ElementRef<HTMLElement>>('leg')

  protected readonly ENCAIXE = ENCAIXE
  protected readonly linkPerfil = linkPerfil
  protected readonly linkPost = linkPost
  protected readonly numInteiro = numInteiro

  constructor() {
    afterNextRender(() => {
      const el = this.leg()?.nativeElement
      if (el) this.legendaLonga.set(el.scrollHeight > el.clientHeight + 2)
    })
  }

  protected mover(d: number): void {
    const n = this.post().midias.length
    this.slide.update((s) => (s + d + n) % n)
  }

  protected readonly temVideo = computed(() => ehVideo(this.post().tipo) || this.post().midias.some((m) => m.video))

  protected readonly sobreAutor = computed(() => {
    const p = this.post()
    return [p.autorNome, p.seguidores ? `${numCurto(p.seguidores)} seguidores` : null, p.autorCategoria].filter(Boolean).join(' · ')
  })

  protected readonly info = computed(() => {
    const p = this.post()
    const f = p.features
    return [
      p.tipo ? (TIPO_POST[p.tipo] ?? p.tipo) : null,
      p.duracao ? `${Math.round(p.duracao)}s` : null,
      p.slides > 1 ? `${p.slides} slides` : null,
      p.takenAt ? `${dataLonga(p.takenAt)}${f?.diaSemana ? ` (${f.diaSemana}${f.hora !== null ? `, ${f.hora}h` : ''})` : ''}` : null,
      f?.publi ? 'publicidade declarada' : null,
    ]
      .filter(Boolean)
      .join(' · ')
  })

  protected readonly sinal = computed(() => {
    const p = this.post()
    return [
      p.totalSementes ? `${p.sementes} de ${p.totalSementes} sementes seguem @${p.autor}` : null,
      p.desempenho !== null ? `${vezes(p.desempenho)} o normal do autor (${p.postsDoAutor} posts dele no banco)` : null,
    ]
      .filter(Boolean)
      .join(' · ')
  })

  protected pct(c: number): string {
    return `${Math.round(c * 100)}%`
  }
}
