import { Component, computed, effect, inject, signal, untracked } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { MatButtonModule } from '@angular/material/button'
import { MatChipInputEvent, MatChipsModule } from '@angular/material/chips'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatIconModule } from '@angular/material/icon'
import { MatInputModule } from '@angular/material/input'
import { MatProgressBarModule } from '@angular/material/progress-bar'
import { MatSnackBar } from '@angular/material/snack-bar'
import { MatTooltipModule } from '@angular/material/tooltip'
import { TextFieldModule } from '@angular/cdk/text-field'
import type { PersonaCompleta, TemaItem, Territorio } from '../core/api'
import { Estado } from '../core/estado'
import { Execucao } from '../core/execucao'
import { FORMATOS } from '../core/formato'
import { NovoCreator } from '../layout/novo-creator'
import { Lista, ListaTemas } from '../comum/lista'
import { MatDialog } from '@angular/material/dialog'

/** exemplos que aparecem dentro de cada campo da entrevista */
const DICA: Record<string, string> = {
  quem_e: 'Ex.: CEO da KXP, software house em BH com 11 pessoas. Cuido de produto e da parte comercial.',
  publico: 'Ex.: donos e diretores de empresas médias que precisam de um sistema sob medida e não sabem por onde começar.',
  assuntos: 'Ex.: como escolher um fornecedor de tecnologia, MVP enxuto, erros que já vi clientes cometerem, bastidores de projeto.',
  pessoal: 'Ex.: corrida de rua, viagens com a família, café especial.',
}
const OBRIGATORIAS = ['quem_e', 'publico']

/** o formulario do territorio: listas viram texto, um item por linha */
interface TerrForm {
  resumo: string
  publico: string
  temas: TemaItem[]
  pessoal: TemaItem[]
  opinioes: string[]
  historias: string[]
  tom: string
  formatos: string[]
}

const linhas = (t: string) =>
  t
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

/** Creator: perfil, entrevista e territorio (o que a IA usa para avaliar posts e gerar ideias). */
@Component({
  selector: 'app-creator',
  imports: [FormsModule, TextFieldModule, Lista, ListaTemas, MatButtonModule, MatChipsModule, MatFormFieldModule, MatIconModule, MatInputModule, MatProgressBarModule, MatTooltipModule],
  template: `
    @if (estado.carregando()) { <mat-progress-bar mode="indeterminate" class="!fixed top-0 right-0 left-0 z-50" /> }
    @if (estado.dados(); as d) {
      @if (!d.persona) {
        <div class="rounded-xl border border-dashed border-linha p-10 text-center">
          <b class="block">Nenhum creator ainda</b>
          <span class="block text-sm text-apagado">Crie o seu: só nome e &#64;; a entrevista vem depois.</span>
          <button mat-flat-button class="!mt-3" (click)="novo()"><mat-icon>add</mat-icon>Novo creator</button>
        </div>
      } @else {
        @let p = d.persona;
        <!-- perfil -->
        <section class="mb-5 flex flex-wrap items-center gap-4 rounded-xl border border-linha bg-cartao p-5">
          <span class="grid size-14 shrink-0 place-items-center rounded-full bg-marca text-2xl font-bold text-white">{{ inicial() }}</span>
          <div class="flex min-w-60 flex-1 flex-col gap-1">
            <input [(ngModel)]="nome" (ngModelChange)="perfilMudou.set(true)" maxlength="60" aria-label="Nome"
                   class="rounded-md border border-transparent bg-transparent px-2 py-1 text-xl font-bold hover:border-linha focus:border-marca focus:outline-none" />
            <input [(ngModel)]="handle" (ngModelChange)="perfilMudou.set(true)" maxlength="40" placeholder="@ do Instagram" aria-label="@ do Instagram"
                   class="rounded-md border border-transparent bg-transparent px-2 py-1 text-apagado hover:border-linha focus:border-marca focus:outline-none" />
          </div>
          <div class="flex flex-wrap gap-2 text-[13px]">
            <span class="rounded-full px-3 py-1" [class]="respondidas() === perguntas().length ? 'bg-emerald-100 text-emerald-800' : 'bg-black/5 text-apagado'">
              Entrevista {{ respondidas() }}/{{ perguntas().length }}
            </span>
            <span class="rounded-full px-3 py-1" [class]="p.territorio ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'">
              {{ p.territorio ? 'Território pronto' : 'Território não gerado' }}
            </span>
          </div>
          @if (perfilMudou()) { <button mat-flat-button (click)="salvarEntrevista()">Salvar perfil</button> }
        </section>

        <!-- funil do ciclo: onde parou -->
        @if (d.funil; as f) {
          <div class="mb-5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-apagado" matTooltip="Onde o ciclo da semana está">
            @for (x of funil(); track x[1]) {
              @if ($index) { <mat-icon class="!size-4 !text-[16px] opacity-50">chevron_right</mat-icon> }
              <span><b class="text-tinta">{{ x[0] }}</b> {{ x[1] }}</span>
            }
          </div>
        }

        <div class="flex flex-col gap-5">
          <!-- entrevista -->
          <section class="rounded-xl border border-linha bg-cartao p-5">
            <h2 class="m-0 text-[18px] font-bold">Entrevista</h2>
            <p class="m-0 mt-1 mb-3 text-sm text-apagado">Respostas curtas. As obrigatórias bastam para começar; o resto dá para completar depois.</p>
            <div class="mb-4 h-1.5 overflow-hidden rounded-full bg-black/5"><div class="h-full bg-marca transition-all" [style.width.%]="(respondidas() / perguntas().length) * 100"></div></div>

            <ol class="m-0 flex list-none flex-col gap-4 p-0">
              @for (q of perguntas(); track q.chave) {
                <li class="flex gap-3">
                  <span class="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full text-xs font-bold"
                        [class]="feita(q.chave) ? 'bg-marca text-white' : 'bg-black/5 text-apagado'">
                    @if (feita(q.chave)) { <mat-icon class="!size-4 !text-[16px]">check</mat-icon> } @else { {{ $index + 1 }} }
                  </span>
                  <div class="min-w-0 flex-1">
                    <div class="mb-1 flex flex-wrap items-center gap-2 text-[14px] font-semibold">
                      {{ q.chave === 'fora' ? q.pergunta.replace(' Um por linha.', '') : q.pergunta }}
                      @if (obrigatoria(q.chave)) { <span class="rounded-full bg-marca-suave px-2 py-0.5 text-[11px] font-semibold text-marca">obrigatória</span> }
                    </div>
                    @if (q.chave === 'fora') {
                      <mat-form-field appearance="outline" subscriptSizing="dynamic" class="w-full">
                        <mat-chip-grid #grade aria-label="Temas que ficam de fora">
                          @for (t of fora(); track t) {
                            <mat-chip-row (removed)="tirarFora(t)">{{ t }}<button matChipRemove [attr.aria-label]="'Remover ' + t"><mat-icon>cancel</mat-icon></button></mat-chip-row>
                          }
                          <input [matChipInputFor]="grade" [matChipInputSeparatorKeyCodes]="separadores" [matChipInputAddOnBlur]="true" (matChipInputTokenEnd)="porFora($event)"
                                 [placeholder]="fora().length ? 'mais um tema…' : 'ex.: política — Enter para adicionar'" maxlength="80" />
                        </mat-chip-grid>
                      </mat-form-field>
                    } @else {
                      <mat-form-field appearance="outline" subscriptSizing="dynamic" class="w-full">
                        <textarea matInput cdkTextareaAutosize rows="2" [(ngModel)]="respostas[q.chave]" (ngModelChange)="mexeuEntrevista()" [placeholder]="dica(q.chave)"></textarea>
                      </mat-form-field>
                    }
                  </div>
                </li>
              }
            </ol>

            <div class="mt-5 flex flex-wrap items-center gap-2">
              <button mat-flat-button (click)="salvarEGerar()" [disabled]="!d.api?.chave || ex.rodando()"
                      [matTooltip]="d.api?.chave ? 'A IA lê a entrevista e escreve o território' : 'Sem chave de API no servidor'">
                <mat-icon>auto_awesome</mat-icon>{{ p.territorio ? 'Salvar e gerar o território de novo' : 'Salvar e gerar o território' }}
              </button>
              <button mat-stroked-button (click)="salvarEntrevista()">Só salvar</button>
              @if (!prontaParaGerar()) { <span class="text-[13px] text-apagado">Responda as obrigatórias (1 e 2) para gerar.</span> }
            </div>
          </section>

          <!-- territorio -->
          <section class="rounded-xl border border-linha bg-cartao p-5">
            <h2 class="m-0 text-[18px] font-bold">Território</h2>
            <p class="m-0 mt-1 mb-4 text-sm text-apagado">
              {{ p.territorio ? 'Revise e ajuste. Mudar o território reavalia os posts na próxima rodada.' : 'Ainda não gerado. Responda a entrevista e gere com a IA, ou preencha à mão.' }}
            </p>
            <div class="flex flex-col gap-4">
              @for (c of camposTexto; track c.chave) {
                <mat-form-field appearance="outline" subscriptSizing="dynamic">
                  <mat-label>{{ c.rotulo }}</mat-label>
                  <textarea matInput cdkTextareaAutosize [rows]="c.linhas" [(ngModel)]="terr[c.chave]" (ngModelChange)="terrMudou.set(true)" [placeholder]="c.dica"></textarea>
                </mat-form-field>
              }
              <app-lista-temas rotulo="Temas profissionais" dica="Tema (ex.: MVP enxuto)" dicaDetalhe="O que você tem a dizer (ex.: MVP bom é MVP pequeno)"
                               [(itens)]="terr.temas" (itensChange)="terrMudou.set(true)" />
              <app-lista-temas rotulo="Lado pessoal" dica="Ex.: corrida de rua" dicaDetalhe="Detalhe (opcional)"
                               [(itens)]="terr.pessoal" (itensChange)="terrMudou.set(true)" />
              <app-lista rotulo="Opiniões fortes" dica="Uma opinião (ex.: software sob medida não é luxo)" [(itens)]="terr.opinioes" (itensChange)="terrMudou.set(true)" />
              <app-lista rotulo="Histórias" dica="Uma história que você sempre conta" [(itens)]="terr.historias" (itensChange)="terrMudou.set(true)" />
              <mat-form-field appearance="outline" subscriptSizing="dynamic">
                <mat-label>Tom</mat-label>
                <input matInput [(ngModel)]="terr.tom" (ngModelChange)="terrMudou.set(true)" placeholder="Como quer soar" />
              </mat-form-field>
              <div class="mt-1">
                <div class="mb-2 text-[14px] font-semibold">Formatos em que fica à vontade</div>
                <mat-chip-listbox multiple [(ngModel)]="terr.formatos" (ngModelChange)="terrMudou.set(true)" aria-label="Formatos">
                  @for (f of formatos; track f[0]) { <mat-chip-option [value]="f[0]">{{ f[1] }}</mat-chip-option> }
                </mat-chip-listbox>
              </div>
            </div>
            <div class="mt-5 flex items-center gap-2">
              <button mat-flat-button (click)="salvarTerritorio()" [disabled]="salvando()">Salvar território</button>
              @if (terrMudou()) { <span class="text-[13px] text-apagado">alterações não salvas</span> }
            </div>
          </section>
        </div>
      }
    }
  `,
})
export class Creator {
  protected readonly estado = inject(Estado)
  protected readonly ex = inject(Execucao)
  private readonly avisos = inject(MatSnackBar)
  private readonly dialogo = inject(MatDialog)

  protected nome = ''
  protected handle = ''
  protected respostas: Record<string, string> = {}
  protected readonly fora = signal<string[]>([])
  protected terr: TerrForm = this.terrDe(null)
  protected readonly perfilMudou = signal(false)
  protected readonly entrevistaMudou = signal(false)
  protected readonly terrMudou = signal(false)
  protected readonly salvando = signal(false)
  // contador para o computed das respostas enxergar o ngModel
  private readonly toque = signal(0)

  protected readonly separadores = [13, 188]
  protected readonly formatos = Object.entries(FORMATOS)
  protected readonly camposTexto: { chave: 'resumo' | 'publico'; rotulo: string; linhas: number; dica: string }[] = [
    { chave: 'resumo', rotulo: 'Quem é', linhas: 2, dica: '2 ou 3 frases: quem é, o que faz' },
    { chave: 'publico', rotulo: 'Quem quer atrair', linhas: 2, dica: 'O público, em uma ou duas frases' },
  ]

  protected readonly perguntas = computed(() => this.estado.dados()?.perguntas ?? [])
  protected readonly respondidas = computed(() => {
    this.toque()
    return this.perguntas().filter((q) => this.feita(q.chave)).length
  })
  protected readonly inicial = computed(() => (this.estado.persona()?.nome ?? '?').trim().charAt(0).toUpperCase())
  protected readonly funil = computed<[number, string][]>(() => {
    const f = this.estado.dados()?.funil
    if (!f) return []
    return [
      [f['sementes'] ?? 0, 'sementes'],
      [f['referencias'] ?? 0, 'referências'],
      [f['comLista'] ?? 0, 'com lista'],
      [f['contasGrafo'] ?? 0, 'no grafo'],
      [f['consumidas'] ?? 0, 'consumidas'],
      [f['postsJanela'] ?? 0, `posts em ${f['janelaDias'] ?? 30}d`],
      [f['dentro'] ?? 0, 'dentro'],
      [f['radar'] ?? 0, 'radar'],
    ]
  })

  constructor() {
    // dados novos (outro creator, territorio gerado pela IA): refaz os formularios, sem apagar o que esta sendo editado
    effect(() => {
      const p = this.estado.persona()
      untracked(() => this.preencher(p))
    })
  }

  private idAtual: string | null = null
  private preencher(p: PersonaCompleta | null): void {
    if (!p) return
    const outro = p.id !== this.idAtual
    this.idAtual = p.id
    if (outro || !this.perfilMudou()) {
      this.nome = p.nome
      this.handle = p.handle ? `@${p.handle}` : ''
      this.perfilMudou.set(false)
    }
    if (outro || !this.entrevistaMudou()) {
      const e = p.entrevista ?? {}
      this.respostas = { ...e }
      this.fora.set(linhas(e['fora'] ?? ''))
      this.entrevistaMudou.set(false)
    }
    if (outro || !this.terrMudou()) {
      this.terr = this.terrDe(p)
      this.terrMudou.set(false)
    }
    this.toque.update((n) => n + 1)
  }

  private terrDe(p: PersonaCompleta | null): TerrForm {
    const t = p?.territorio
    return {
      resumo: t?.resumo ?? '',
      publico: t?.publico || p?.publico || '',
      temas: (t?.temas ?? []).map((x) => ({ ...x })),
      pessoal: (t?.pessoal ?? []).map((x) => ({ ...x })),
      opinioes: [...(t?.opinioes ?? [])],
      historias: [...(t?.historias ?? [])],
      tom: t?.tom ?? '',
      formatos: [...(t?.formatos ?? [])],
    }
  }

  protected mexeuEntrevista(): void {
    this.entrevistaMudou.set(true)
    this.toque.update((n) => n + 1)
  }

  protected feita(chave: string): boolean {
    return chave === 'fora' ? this.fora().length > 0 : Boolean((this.respostas[chave] ?? '').trim())
  }
  protected obrigatoria(chave: string): boolean {
    return OBRIGATORIAS.includes(chave)
  }
  protected dica(chave: string): string {
    return DICA[chave] ?? ''
  }
  protected prontaParaGerar(): boolean {
    this.toque()
    return OBRIGATORIAS.every((k) => (this.respostas[k] ?? '').trim())
  }

  protected porFora(e: MatChipInputEvent): void {
    const v = (e.value ?? '').trim().replace(/\s+/g, ' ')
    if (v && !this.fora().some((x) => x.toLowerCase() === v.toLowerCase())) {
      this.fora.update((xs) => [...xs, v])
      this.mexeuEntrevista()
    }
    e.chipInput.clear()
  }
  protected tirarFora(t: string): void {
    this.fora.update((xs) => xs.filter((x) => x !== t))
    this.mexeuEntrevista()
  }

  protected async salvarEntrevista(silencioso = false): Promise<boolean> {
    const p = this.estado.persona()
    if (!p) return false
    const entrevista = { ...this.respostas, fora: this.fora().join('\n') }
    try {
      this.perfilMudou.set(false)
      this.entrevistaMudou.set(false)
      await this.estado.acao('persona.salvar', { persona: p.id, entrevista, nome: this.nome.trim() || p.nome, handle: this.handle.trim() || null })
      if (!silencioso) this.aviso('Salvo.')
      return true
    } catch (e) {
      this.perfilMudou.set(true)
      this.entrevistaMudou.set(true)
      this.aviso((e as Error).message)
      return false
    }
  }

  protected async salvarEGerar(): Promise<void> {
    this.toque.update((n) => n + 1)
    if (!this.prontaParaGerar()) return this.aviso('Responda as perguntas obrigatórias antes de gerar.')
    if (this.terrMudou()) return this.aviso('Você tem alterações no território sem salvar: salve ou recarregue antes de gerar de novo.')
    if (await this.salvarEntrevista(true)) {
      await this.ex.rodar('territorio')
      this.aviso('Gerando o território. Ele aparece aqui quando a etapa terminar.')
    }
  }

  protected async salvarTerritorio(): Promise<void> {
    const p = this.estado.persona()
    if (!p) return
    const f = this.terr
    const territorio: Territorio = {
      resumo: f.resumo.trim(),
      publico: f.publico.trim(),
      temas: f.temas,
      pessoal: f.pessoal,
      opinioes: f.opinioes,
      historias: f.historias,
      tom: f.tom.trim(),
      formatos: f.formatos,
      fora: p.territorio?.fora ?? [],
    }
    this.salvando.set(true)
    try {
      this.terrMudou.set(false)
      await this.estado.acao('territorio.salvar', { persona: p.id, territorio })
      this.aviso('Território salvo.')
    } catch (e) {
      this.terrMudou.set(true)
      this.aviso((e as Error).message)
    } finally {
      this.salvando.set(false)
    }
  }

  protected novo(): void {
    this.dialogo.open(NovoCreator, { width: '440px', maxWidth: '94vw' })
  }

  private aviso(msg: string): void {
    this.avisos.open(msg, 'OK', { duration: 5000 })
  }
}
