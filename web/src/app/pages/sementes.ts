import { Component, computed, inject, signal } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { MatButtonModule } from '@angular/material/button'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatIconModule } from '@angular/material/icon'
import { MatInputModule } from '@angular/material/input'
import { MatMenuModule } from '@angular/material/menu'
import { MatProgressBarModule } from '@angular/material/progress-bar'
import { MatSelectModule } from '@angular/material/select'
import { MatSnackBar } from '@angular/material/snack-bar'
import { MatTabsModule } from '@angular/material/tabs'
import { MatTooltipModule } from '@angular/material/tooltip'
import type { ContaGrafo } from '../core/api'
import { Estado } from '../core/estado'
import { Execucao } from '../core/execucao'
import { dataLonga, guardado, linkPerfil, numCurto } from '../core/formato'

type Aba = 'sementes' | 'referencias' | 'grafo'
const ABAS: Aba[] = ['sementes', 'referencias', 'grafo']

const PAPEL: Record<string, string> = { consumido: 'Consumido', par: 'Par (público)', fora: 'Fora', candidata: 'A avaliar' }

/** etapas que rodam para uma conta so */
const ACAO_CONTA: Record<string, [string, string]> = {
  visitar: ['Visitar agora', 'abre o Chrome'],
  transcrever: ['Transcrever reels', ''],
  classificar: ['Classificar a conta', 'IA: consumido, par ou fora'],
  avaliar: ['Avaliar os posts da conta', 'IA: dentro, radar ou fora do território'],
  seguindo: ['Coletar “seguindo” agora', 'abre o Chrome'],
  atualizar: ['Atualizar tudo', 'visitar → transcrever → classificar → avaliar'],
}

interface ResultadoAdd {
  adicionadas: string[]
  jaExistiam?: string[]
  invalidas: string[]
}

/** Sementes (o publico), referencias (quem fala do mesmo assunto) e o grafo que sai das sementes. */
@Component({
  selector: 'app-sementes',
  imports: [FormsModule, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatMenuModule, MatProgressBarModule, MatSelectModule, MatTabsModule, MatTooltipModule],
  template: `
    @if (estado.carregando()) { <mat-progress-bar mode="indeterminate" class="!fixed top-0 right-0 left-0 z-50" /> }
    @if (estado.dados(); as d) {
      @if (!d.persona) {
        <div class="rounded-xl border border-dashed border-linha p-10 text-center text-apagado">Escolha ou crie um creator primeiro.</div>
      } @else {
        <mat-tab-group [selectedIndex]="indice()" (selectedIndexChange)="trocarAba($event)" animationDuration="0ms" mat-stretch-tabs="false" class="mb-4">
          <mat-tab [label]="'Sementes · ' + nSementes()" />
          <mat-tab [label]="'Referências · ' + nReferencias()" />
          <mat-tab [label]="'Grafo · ' + (d.grafo?.length ?? 0)" />
        </mat-tab-group>

        <!-- menu de acoes de uma conta (reaproveitado em todas as listas) -->
        <mat-menu #menuConta="matMenu">
          <ng-template matMenuContent let-u="u" let-acoes="acoes">
            <div class="px-4 pt-2 pb-1 text-xs text-apagado">Só para &#64;{{ u }}</div>
            @for (a of acoes; track a) {
              <button mat-menu-item (click)="ex.rodar('conta-' + a, u)" [disabled]="ex.rodando()">
                <span class="flex flex-col leading-tight"><span class="text-sm">{{ ACAO[a][0] }}</span>
                  @if (dicaAcao(a, acoes)) { <span class="text-xs text-apagado">{{ dicaAcao(a, acoes) }}</span> }</span>
              </button>
            }
          </ng-template>
        </mat-menu>

        <section class="rounded-xl border border-linha bg-cartao p-5">
          @switch (aba()) {
            @case ('sementes') {
              <div class="mb-4 flex flex-wrap items-start gap-3">
                <div class="min-w-64 flex-1">
                  <h2 class="m-0 text-[18px] font-bold">Sementes</h2>
                  <p class="m-0 mt-1 text-sm text-apagado">Perfis reais de quem {{ d.persona.nome }} quer atrair. Comece com uns 10; perfil privado não serve. O grafo sai do que elas seguem.</p>
                </div>
                <button mat-flat-button (click)="ex.rodar('seguindo')" [disabled]="ex.rodando()" matTooltip="Abre o Chrome e lê quem cada semente segue"><mat-icon>group_add</mat-icon>Coletar “seguindo”</button>
              </div>
              <div class="mb-5 flex gap-2">
                <mat-form-field appearance="outline" subscriptSizing="dynamic" class="campo-compacto flex-1">
                  <input matInput [(ngModel)]="novasSementes" (keydown.enter)="adicionar('sementes.add')" placeholder="@fulano, @ciclana ou link do perfil (vários de uma vez)" autocomplete="off" />
                </mat-form-field>
                <button mat-stroked-button class="!h-10" (click)="adicionar('sementes.add')" [disabled]="!novasSementes.trim()">Adicionar</button>
              </div>

              @if (sugSementes().length) {
                <div class="mb-5 rounded-xl bg-marca-suave/60 p-4">
                  <h3 class="m-0 mb-1 text-[15px] font-semibold">Sugeridas pelo grafo</h3>
                  <p class="m-0 mb-3 text-[13px] text-apagado">Parecem ser do público e postam pouco. Confira o perfil antes de confirmar.</p>
                  @for (s of sugSementes(); track s.username) {
                    <div class="flex flex-wrap items-center gap-3 border-t border-black/5 py-2">
                      <a [href]="linkPerfil(s.username)" target="_blank" rel="noopener" class="font-semibold text-tinta">&#64;{{ s.username }}</a>
                      <span class="min-w-0 flex-1 text-[13px] text-apagado">{{ s.motivo }}</span>
                      <button mat-stroked-button class="!h-8" (click)="statusSemente(s.username, 'confirmada')">Confirmar</button>
                      <button mat-button class="!h-8" (click)="statusSemente(s.username, 'rejeitada')">Rejeitar</button>
                    </div>
                  }
                </div>
              }

              @for (s of listaSementes(); track s.username) {
                <div class="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-linha py-3" [class.opacity-60]="s.status !== 'confirmada'">
                  <div class="min-w-48 flex-1">
                    <a [href]="linkPerfil(s.username)" target="_blank" rel="noopener" class="font-semibold text-tinta">&#64;{{ s.username }}</a>
                    @if (s.origem === 'grafo') { <span class="ml-2 text-xs text-apagado">via grafo</span> }
                    @if (s.fullName) { <div class="text-[13px] text-apagado">{{ s.fullName }}</div> }
                  </div>
                  <div class="w-44 text-[13px]">
                    @if (s.contas) { <b>{{ s.contas }}</b>@if (s.followingCount) { <span class="text-apagado"> de {{ s.followingCount }}</span> } <span class="text-apagado"> seguindo</span> }
                    @else { <span class="text-apagado">lista não coletada</span> }
                    @if (s.erro) { <div class="text-red-700">{{ s.erro }}</div> }
                  </div>
                  <div class="w-28 text-[13px] text-apagado">{{ s.coletadaEm ? dataLonga(s.coletadaEm) : '—' }}</div>
                  <div class="flex items-center gap-1">
                    @if (s.status === 'confirmada') {
                      <button mat-icon-button [matMenuTriggerFor]="menuConta" [matMenuTriggerData]="{ u: s.username, acoes: ['seguindo'] }" aria-label="Ações da conta"><mat-icon>more_horiz</mat-icon></button>
                      <button mat-button class="!h-8" (click)="statusSemente(s.username, 'rejeitada')">Desativar</button>
                    } @else {
                      <button mat-button class="!h-8" (click)="statusSemente(s.username, 'confirmada')">Reativar</button>
                    }
                    <button mat-button class="!h-8 !text-red-700" (click)="statusSemente(s.username, 'remover')">Remover</button>
                  </div>
                </div>
              } @empty {
                <p class="m-0 text-sm text-apagado">Nenhuma semente ainda.</p>
              }
            }

            @case ('referencias') {
              <div class="mb-4 flex flex-wrap items-start gap-3">
                <div class="min-w-64 flex-1">
                  <h2 class="m-0 text-[18px] font-bold">Referências</h2>
                  <p class="m-0 mt-1 text-sm text-apagado">Gente que posta conteúdo próprio sobre o mesmo assunto.</p>
                </div>
                <button mat-flat-button (click)="ex.rodar('acompanhar')" [disabled]="ex.rodando()" matTooltip="Abre o Chrome e traz os posts novos"><mat-icon>travel_explore</mat-icon>Visitar contas</button>
              </div>
              <div class="mb-5 flex gap-2">
                <mat-form-field appearance="outline" subscriptSizing="dynamic" class="campo-compacto flex-1">
                  <input matInput [(ngModel)]="novasReferencias" (keydown.enter)="adicionar('referencias.add')" placeholder="@fulano_ceo ou link do perfil (vários de uma vez)" autocomplete="off" />
                </mat-form-field>
                <button mat-stroked-button class="!h-10" (click)="adicionar('referencias.add')" [disabled]="!novasReferencias.trim()">Adicionar</button>
              </div>

              @for (grupo of gruposRef(); track grupo.titulo) {
                @if (grupo.itens.length) {
                  <div [class]="grupo.sugestao ? 'mb-5 rounded-xl bg-marca-suave/60 p-4' : ''">
                    @if (grupo.sugestao) {
                      <h3 class="m-0 mb-1 text-[15px] font-semibold">Sugeridas pelo grafo</h3>
                      <p class="m-0 mb-3 text-[13px] text-apagado">Creators que o público segue e falam do mesmo assunto. Confira antes de ativar.</p>
                    }
                    @for (r of grupo.itens; track r.username) {
                      <div class="flex flex-wrap items-center gap-x-4 gap-y-1 border-t py-3" [class]="grupo.sugestao ? 'border-black/5' : 'border-linha'" [class.opacity-60]="r.status === 'pausada'">
                        <div class="min-w-48 flex-1">
                          <a [href]="linkPerfil(r.username)" target="_blank" rel="noopener" class="font-semibold text-tinta">&#64;{{ r.username }}</a>
                          @if (r.status === 'pausada') { <span class="ml-2 rounded-full bg-black/5 px-2 py-0.5 text-xs text-apagado">pausada</span> }
                          @if (r.fullName) { <div class="text-[13px] text-apagado">{{ r.fullName }}</div> }
                          @if (r.motivo) { <div class="text-[13px] text-apagado">{{ r.motivo }}</div> }
                        </div>
                        <div class="w-56 text-[13px] text-apagado">
                          @if (r.lastWatchedAt) { {{ dataLonga(r.lastWatchedAt) }} · {{ r.posts }} posts · <b class="text-tinta">{{ r.dentro }}</b> dentro } @else { ainda não visitada }
                        </div>
                        <div class="flex items-center gap-1">
                          @if (r.status === 'ativa') {
                            <button mat-icon-button [matMenuTriggerFor]="menuConta" [matMenuTriggerData]="{ u: r.username, acoes: ['visitar', 'transcrever', 'avaliar', 'atualizar'] }" aria-label="Ações da conta"><mat-icon>more_horiz</mat-icon></button>
                            <button mat-button class="!h-8" (click)="statusReferencia(r.username, 'pausada')">Pausar</button>
                          } @else {
                            <button mat-stroked-button class="!h-8" (click)="statusReferencia(r.username, 'ativa')">Ativar</button>
                          }
                          <button mat-button class="!h-8 !text-red-700" (click)="statusReferencia(r.username, 'remover')">Remover</button>
                        </div>
                      </div>
                    }
                  </div>
                }
              }
              @if (!(d.referencias ?? []).length) { <p class="m-0 text-sm text-apagado">Nenhuma referência ainda.</p> }
            }

            @case ('grafo') {
              <div class="mb-4 flex flex-wrap items-start gap-3">
                <div class="min-w-64 flex-1">
                  <h2 class="m-0 text-[18px] font-bold">Grafo</h2>
                  <p class="m-0 mt-1 text-sm text-apagado">
                    Entra quem é seguido por pelo menos <b class="text-tinta">{{ d.minimo }}</b> das {{ d.funil?.['comLista'] ?? 0 }} sementes com lista. As contas são visitadas e a IA diz se o público consome, se é alguém do público ou nada.
                  </p>
                </div>
                <div class="flex flex-wrap gap-2">
                  <button mat-flat-button (click)="ex.rodar('grafo')" [disabled]="ex.rodando()">Recalcular grafo</button>
                  <button mat-stroked-button (click)="ex.rodar('acompanhar')" [disabled]="ex.rodando()">Visitar contas</button>
                  <button mat-stroked-button (click)="ex.rodar('contas')" [disabled]="ex.rodando()">Classificar contas</button>
                </div>
              </div>
              <div class="mb-3 flex flex-wrap gap-2">
                @for (f of filtrosGrafo; track f[0]) {
                  <button class="rounded-full border px-3 py-1 text-[13px]" (click)="filtroGrafo.set(f[0])"
                          [class]="filtroGrafo() === f[0] ? 'border-marca bg-marca-suave text-marca' : 'border-linha bg-transparent text-apagado'">{{ f[1] }} · {{ contagem(f[0]) }}</button>
                }
              </div>
              @for (c of grafoFiltrado(); track c.username) {
                <div class="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-linha py-3">
                  <div class="min-w-52 flex-1">
                    <div class="flex flex-wrap items-center gap-2">
                      <a [href]="linkPerfil(c.username)" target="_blank" rel="noopener" class="font-semibold text-tinta">&#64;{{ c.username }}</a>
                      @if (c.papel === 'consumido') {
                        @if (ehReferencia(c.username)) { <span class="rounded-full bg-black/5 px-2 py-0.5 text-xs">referência</span> }
                        @else { <button mat-button class="!h-6 !px-2 !text-xs" (click)="virar('referencias.add', c.username)">+ referência</button> }
                      } @else {
                        @if (ehSemente(c.username)) { <span class="rounded-full bg-black/5 px-2 py-0.5 text-xs">semente</span> }
                        @else { <button mat-button class="!h-6 !px-2 !text-xs" (click)="virar('sementes.add', c.username)">+ semente</button> }
                      }
                      @if (c.candidataSemente) { <span class="rounded-full bg-marca-suave px-2 py-0.5 text-xs text-marca">par do público</span> }
                    </div>
                    @if (c.fullName) { <div class="text-[13px] text-apagado">{{ c.fullName }}</div> }
                    <div class="mt-1 text-[13px]">
                      @if (c.tema) { <b>{{ c.tema }}</b> · }
                      <span class="text-apagado">{{ c.motivo || (c.bio ?? '').slice(0, 160) }}</span>
                    </div>
                  </div>
                  <div class="w-24 text-[13px]"><b>{{ c.sementes }}</b><span class="text-apagado"> de {{ d.funil?.['comLista'] ?? 0 }}</span></div>
                  <div class="w-24 text-[13px] text-apagado">{{ c.followers !== null ? numCurto(c.followers) + ' seg.' : '—' }}</div>
                  <div class="w-36 text-[13px] text-apagado">{{ c.lastWatchedAt ? dataLonga(c.lastWatchedAt) + ' · ' + c.posts + ' posts' : 'ainda não visitada' }}</div>
                  <div class="flex w-full items-center gap-1 sm:w-auto">
                    <mat-form-field appearance="outline" subscriptSizing="dynamic" class="campo-compacto w-48">
                      <mat-select [value]="c.source === 'humano' ? c.papel : ''" (selectionChange)="papel(c, $event.value)" aria-label="Papel">
                        <mat-option value="">{{ c.source === 'humano' ? 'voltar para a IA' : '(' + (c.source === 'llm' ? 'IA' : 'sem avaliação') + ') ' + (PAPEL[c.papel] ?? c.papel) }}</mat-option>
                        @for (k of ['consumido', 'par', 'fora']; track k) { <mat-option [value]="k">{{ PAPEL[k] }}</mat-option> }
                      </mat-select>
                    </mat-form-field>
                    <button mat-icon-button [matMenuTriggerFor]="menuConta" [matMenuTriggerData]="{ u: c.username, acoes: ['visitar', 'transcrever', 'classificar', 'avaliar', 'atualizar'] }" aria-label="Ações da conta"><mat-icon>more_horiz</mat-icon></button>
                  </div>
                </div>
              } @empty {
                <p class="m-0 text-sm text-apagado">{{ (d.grafo ?? []).length ? 'Nenhuma conta neste filtro.' : 'Vazio. Colete o “seguindo” das sementes e recalcule o grafo.' }}</p>
              }
            }
          }
        </section>
      }
    }
  `,
})
export class Sementes {
  protected readonly estado = inject(Estado)
  protected readonly ex = inject(Execucao)
  private readonly avisos = inject(MatSnackBar)

  protected readonly aba = signal<Aba>(ABAS.includes(guardado.ler('cx-sub') as Aba) ? (guardado.ler('cx-sub') as Aba) : 'sementes')
  protected readonly indice = computed(() => ABAS.indexOf(this.aba()))
  protected readonly filtroGrafo = signal<string>('todas')
  protected novasSementes = ''
  protected novasReferencias = ''

  protected readonly ACAO = ACAO_CONTA
  protected readonly PAPEL = PAPEL
  protected readonly linkPerfil = linkPerfil
  protected readonly dataLonga = dataLonga
  protected readonly numCurto = numCurto
  protected readonly filtrosGrafo: [string, string][] = [
    ['todas', 'Todas'],
    ['consumido', 'Consumidas'],
    ['par', 'Par'],
    ['fora', 'Fora'],
    ['candidata', 'A avaliar'],
  ]

  private readonly sementesTodas = computed(() => this.estado.dados()?.sementes ?? [])
  protected readonly sugSementes = computed(() => this.sementesTodas().filter((s) => s.status === 'sugerida'))
  protected readonly listaSementes = computed(() => this.sementesTodas().filter((s) => s.status !== 'sugerida'))
  protected readonly nSementes = computed(() => this.sementesTodas().filter((s) => s.status === 'confirmada').length)
  private readonly refs = computed(() => this.estado.dados()?.referencias ?? [])
  protected readonly nReferencias = computed(() => this.refs().filter((r) => r.status === 'ativa').length)
  protected readonly gruposRef = computed(() => [
    { titulo: 'sugeridas', sugestao: true, itens: this.refs().filter((r) => r.status === 'sugerida') },
    { titulo: 'lista', sugestao: false, itens: this.refs().filter((r) => r.status !== 'sugerida') },
  ])
  private readonly grafo = computed(() => this.estado.dados()?.grafo ?? [])
  protected readonly grafoFiltrado = computed(() => {
    const f = this.filtroGrafo()
    return f === 'todas' ? this.grafo() : this.grafo().filter((c) => c.papel === f)
  })

  protected trocarAba(i: number): void {
    const a = ABAS[i] ?? 'sementes'
    this.aba.set(a)
    guardado.gravar('cx-sub', a)
  }

  protected contagem(f: string): number {
    return f === 'todas' ? this.grafo().length : this.grafo().filter((c) => c.papel === f).length
  }

  protected dicaAcao(a: string, acoes: string[]): string {
    return a === 'atualizar' && !acoes.includes('classificar') ? 'visitar → transcrever → avaliar' : (ACAO_CONTA[a]?.[1] ?? '')
  }

  protected ehSemente(u: string): boolean {
    return this.sementesTodas().some((s) => s.username === u && s.status !== 'rejeitada')
  }
  protected ehReferencia(u: string): boolean {
    return this.refs().some((r) => r.username === u && r.status === 'ativa')
  }

  protected async adicionar(acao: 'sementes.add' | 'referencias.add'): Promise<void> {
    const texto = acao === 'sementes.add' ? this.novasSementes : this.novasReferencias
    if (!texto.trim()) return
    try {
      const r = await this.estado.acao<ResultadoAdd>(acao, { texto })
      if (acao === 'sementes.add') this.novasSementes = ''
      else this.novasReferencias = ''
      const partes = [`${r.adicionadas.length} adicionada${r.adicionadas.length === 1 ? '' : 's'}`]
      if (r.jaExistiam?.length) partes.push(`${r.jaExistiam.length} já existia${r.jaExistiam.length === 1 ? '' : 'm'}`)
      if (r.invalidas.length) partes.push(`inválidas: ${r.invalidas.join(', ')}`)
      this.aviso(partes.join(', ') + (acao === 'referencias.add' && r.adicionadas.length ? '. Clique em “Visitar contas” para trazer os posts.' : '.'))
    } catch (e) {
      this.aviso((e as Error).message)
    }
  }

  protected async virar(acao: 'sementes.add' | 'referencias.add', u: string): Promise<void> {
    try {
      const r = await this.estado.acao<ResultadoAdd>(acao, { texto: u })
      const tipo = acao === 'sementes.add' ? 'semente' : 'referência'
      this.aviso(r.adicionadas.length ? `@${u} agora é ${tipo}.` : `@${u} já era ${tipo}.`)
    } catch (e) {
      this.aviso((e as Error).message)
    }
  }

  protected statusSemente(username: string, status: 'confirmada' | 'rejeitada' | 'remover'): void {
    void this.mandar('semente.status', { username, status })
  }

  protected statusReferencia(username: string, status: 'ativa' | 'pausada' | 'remover'): void {
    void this.mandar('referencia.status', { username, status })
  }

  protected papel(c: ContaGrafo, papel: string): void {
    void this.mandar('conta.papel', { username: c.username, papel: papel || null }, papel ? `@${c.username}: ${PAPEL[papel]}` : `@${c.username} voltou para a avaliação da IA`)
  }

  private async mandar(acao: string, dados: Record<string, unknown>, ok?: string): Promise<void> {
    try {
      await this.estado.acao(acao, dados)
      if (ok) this.aviso(ok)
    } catch (e) {
      this.aviso((e as Error).message)
    }
  }

  private aviso(msg: string): void {
    this.avisos.open(msg, 'OK', { duration: 5000 })
  }
}
