import { Component, computed, inject, input, output, signal } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { MatButtonModule } from '@angular/material/button'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatIconModule } from '@angular/material/icon'
import { MatInputModule } from '@angular/material/input'
import { MatSelectModule } from '@angular/material/select'
import { MatSnackBar } from '@angular/material/snack-bar'
import { MatTooltipModule } from '@angular/material/tooltip'
import type { IdeiaDetalhe, Roteiro as RoteiroRow, RoteiroConteudo } from '../core/api'
import { Estado } from '../core/estado'
import { Lista } from '../comum/lista'
import { dataHora, ehGravado, limparFala, paragrafos, pecaDe, trechos } from '../core/formato'

/** o que o editor mexe: os campos de lista viram texto, um por linha */
interface Edicao {
  gravacao: string
  audioTipo: string
  audioNome: string
  tom: string
  fala: string
  formato: string
  duracao: number | null
  tela: string[]
  outras: string[]
  legenda: string
  lembretes: string[]
}

// resposta digitada e ainda nao usada, por ideia: sobrevive a fechar e abrir o detalhe
const rascunhos = new Map<string, string>()

/** Secao de roteiro do detalhe: gera, mostra as versoes, edita, ajusta e marca como gravado. */
@Component({
  selector: 'app-roteiro',
  imports: [FormsModule, Lista, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatSelectModule, MatTooltipModule],
  styles: `
    .preencher { background: #fff3c4; border-radius: 3px; padding: 0 2px; }
    .grande p { font-size: 22px; line-height: 1.5; }
  `,
  template: `
    @let i = ideia();
    <section class="border-t border-linha pt-5" id="roteiro">
      <h3 class="m-0 mb-3 text-[17px] font-semibold">Roteiro</h3>

      @if (erro(); as e) {
        <div class="mb-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800"><b>A última geração falhou.</b> {{ e }}</div>
      }

      @if (atual(); as r) {
        @let c = r.conteudo;
        <div class="mb-3 flex flex-wrap items-center gap-2 text-[13px]">
          <span class="text-apagado">{{ i.roteiros.length === 1 ? '1 versão' : i.roteiros.length + ' versões' }}:</span>
          @for (v of i.roteiros; track v.id) {
            <button class="rounded-full border px-2.5 py-0.5 text-[13px]" [class]="v.versao === r.versao ? 'border-marca bg-marca-suave text-marca' : 'border-linha bg-transparent'"
                    (click)="versao.set(v.versao)" [matTooltip]="dicaVersao(v)">v{{ v.versao }}@if (v.status === 'gravado') { ✓}</button>
          }
          <span class="text-apagado">· {{ dataHora(r.createdAt) }}@if (r.pedido) { · ajuste: {{ r.pedido }}}@if (r.modelo === 'você') { · editado por você}</span>
        </div>

        @if (!editando()) {
          @if (r.texto) {
            <p class="m-0 mb-2 text-[13px] text-apagado">Editado por você.</p>
            <div class="whitespace-pre-line">@for (t of trechos(r.texto); track $index) {<span [class.preencher]="t.preencher">{{ t.texto }}</span>}</div>
          } @else {
            @if (c.molde) {
              <details class="mb-3 rounded-lg border border-linha px-3 py-2 text-[14px]">
                <summary class="cursor-pointer"><b>Formato@if (c.formato_de) { copiado de &#64;{{ c.formato_de }}}</b> <span class="text-apagado">— o esqueleto {{ grava() ? 'da fala ' : '' }}do post de referência</span></summary>
                <p class="m-0 mt-2 whitespace-pre-line">{{ c.molde }}</p>
              </details>
            }
            @if (c.gravacao) {
              <p class="m-0 mb-2 text-[14px]"><b>{{ grava() ? 'Como gravar' : 'Como montar' }}</b> <span class="text-apagado">(sugestão)</span><br />{{ c.gravacao }}</p>
            }
            @if (audio(); as a) { <p class="m-0 mb-2 text-[14px]"><b>Áudio</b> {{ a }}@if (c.audio.nota) {<br /><span class="text-apagado">{{ c.audio.nota }}</span>}</p> }

            <div class="mt-4 mb-1 flex items-center gap-2">
              <h4 class="m-0 flex-1 text-[14px] font-semibold">{{ tituloFala() }}</h4>
              @if (grava()) { <button mat-button class="!h-7 !text-xs" (click)="letraGrande.set(!letraGrande())">{{ letraGrande() ? 'Letra normal' : 'Letra grande' }}</button> }
            </div>
            @if (c.tom) { <p class="m-0 mb-2 text-[13px] text-apagado italic">{{ c.tom }}</p> }
            <div class="rounded-lg bg-black/[0.03] p-4 text-[15px] leading-relaxed" [class.grande]="letraGrande()">
              @for (par of falas(); track $index) {
                <p class="m-0 mb-3 last:mb-0">
                  @if (!grava() && peca() !== 'foto') { <span class="mr-2 rounded bg-marca-suave px-1.5 py-0.5 text-[11px] font-semibold text-marca">Slide {{ $index + 1 }}</span> }
                  @for (t of trechos(par); track $index) {<span [class.preencher]="t.preencher">{{ t.texto }}</span>}
                </p>
              }
            </div>
            @if (grava() && c.tela.length) {
              <h4 class="m-0 mt-4 mb-1 text-[14px] font-semibold">Texto na tela</h4>
              <div class="flex flex-wrap gap-1">@for (t of c.tela; track $index) { <span class="rounded-full bg-black/5 px-2 py-0.5 text-[13px]">{{ t }}</span> }</div>
            }
            @if (c.ganchos.length > 1) {
              <h4 class="m-0 mt-4 mb-1 text-[14px] font-semibold">Outras opções de abertura</h4>
              <ul class="m-0 pl-5">@for (g of c.ganchos.slice(1); track $index) { <li>“{{ limpar(g.texto) }}”</li> }</ul>
            }
            <h4 class="m-0 mt-4 mb-1 text-[14px] font-semibold">Legenda</h4>
            <div class="whitespace-pre-line">@for (t of trechos(c.legenda || '—'); track $index) {<span [class.preencher]="t.preencher">{{ t.texto }}</span>}</div>
            @if (c.lembretes.length) {
              <div class="mt-4 rounded-lg bg-marca-suave px-4 py-3 text-[14px]">
                <b>{{ grava() ? 'Dicas para gravar' : 'Dicas' }}</b>
                <ul class="m-0 mt-1 pl-5">@for (l of c.lembretes; track $index) { <li>@for (t of trechos(l); track $index) {<span [class.preencher]="t.preencher">{{ t.texto }}</span>}</li> }</ul>
              </div>
            }
          }

          <div class="mt-4 flex flex-wrap items-center gap-2">
            <button mat-stroked-button (click)="copiar(r)"><mat-icon>content_copy</mat-icon>Copiar</button>
            <button mat-stroked-button (click)="abrirEditor(r)"><mat-icon>edit</mat-icon>Editar</button>
            @if (r.status === 'gravado') {
              <span class="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[13px] text-emerald-800">gravado</span>
              <button mat-button (click)="status(r, 'rascunho')">desfazer</button>
            } @else {
              <button mat-stroked-button (click)="status(r, 'gravado')"><mat-icon>check</mat-icon>Marcar como gravado</button>
            }
            <span class="flex-1"></span>
            <button mat-button class="!text-red-700" (click)="apagar()">{{ confirmaApagar() ? 'Apagar ' + (i.roteiros.length === 1 ? 'a versão' : 'as ' + i.roteiros.length + ' versões') + '? Clique de novo' : 'Começar do zero' }}</button>
          </div>

          @if (i.roteiroApi) {
            <div class="mt-3 flex gap-2">
              <mat-form-field appearance="outline" subscriptSizing="dynamic" class="campo-compacto flex-1">
                <input matInput [(ngModel)]="pedido" maxlength="300" placeholder="Pedir ajuste: mais curto, menos formal, outro gancho, virar carrossel…" (keydown.enter)="ajustar()" />
              </mat-form-field>
              <button mat-stroked-button class="!h-10" (click)="ajustar()" [disabled]="ocupado()">Ajustar</button>
            </div>
          }
        } @else {
          <!-- editor: os mesmos campos da visualizacao -->
          <div class="flex flex-col gap-1">
            <mat-form-field appearance="outline"><mat-label>{{ grava() ? 'Como gravar' : 'Como montar' }} (sugestão)</mat-label><textarea matInput rows="2" [(ngModel)]="ed.gravacao"></textarea></mat-form-field>
            @if (grava()) {
              <div class="grid gap-x-3 sm:grid-cols-2">
                <mat-form-field appearance="outline"><mat-label>Áudio</mat-label>
                  <mat-select [(ngModel)]="ed.audioTipo"><mat-option value="voz">sua voz</mat-option><mat-option value="musica">música/trend</mat-option><mat-option value="voz+musica">voz + música</mat-option></mat-select>
                </mat-form-field>
                <mat-form-field appearance="outline"><mat-label>Nome do áudio</mat-label><input matInput [(ngModel)]="ed.audioNome" /></mat-form-field>
              </div>
            }
            <mat-form-field appearance="outline"><mat-label>Tom</mat-label><input matInput [(ngModel)]="ed.tom" /></mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>{{ grava() ? 'Roteiro (a fala inteira, um parágrafo por ideia)' : 'Texto dos slides (um parágrafo por slide)' }}</mat-label>
              <textarea matInput rows="10" [(ngModel)]="ed.fala"></textarea>
            </mat-form-field>
            <div class="grid gap-x-3 sm:grid-cols-[1fr_160px]">
              <mat-form-field appearance="outline"><mat-label>Formato</mat-label><input matInput [(ngModel)]="ed.formato" /></mat-form-field>
              @if (grava()) { <mat-form-field appearance="outline"><mat-label>Duração (s)</mat-label><input matInput type="number" min="0" max="3600" [(ngModel)]="ed.duracao" /></mat-form-field> }
            </div>
            @if (grava()) { <app-lista class="mb-4 block" rotulo="Texto na tela" dica="Um texto que aparece no vídeo" [max]="200" [(itens)]="ed.tela" /> }
            <app-lista class="mb-4 block" rotulo="Outras opções de abertura" dica="Outra frase para abrir" [max]="300" [(itens)]="ed.outras" />
            <mat-form-field appearance="outline"><mat-label>Legenda</mat-label><textarea matInput rows="4" [(ngModel)]="ed.legenda"></textarea></mat-form-field>
            <app-lista class="mb-4 block" [rotulo]="grava() ? 'Dicas para gravar' : 'Dicas'" dica="Uma dica" [max]="300" [(itens)]="ed.lembretes" />
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <button mat-flat-button (click)="salvarEdicao(r)" [disabled]="ocupado()">Salvar como v{{ (i.roteiros[0]?.versao ?? 0) + 1 }}</button>
            <button mat-button (click)="editando.set(false)">Cancelar</button>
            <span class="text-[13px] text-apagado">A versão da IA continua no histórico.</span>
          </div>
        }
      }

      <!-- nova versao: pergunta da ideia (ou algo seu) e gerar -->
      <div class="rounded-xl bg-black/[0.03] p-4" [class.mt-5]="atual()">
        @if (i.pergunta) {
          <div class="mb-1 text-[13px] font-semibold">Pergunta para {{ nomeCreator() }}</div>
          <p class="m-0 mb-2 text-[15px]">{{ i.pergunta }}</p>
        } @else {
          <div class="mb-1 text-[13px] font-semibold">Algo seu para entrar nesse post (opcional)</div>
        }
        <mat-form-field appearance="outline" subscriptSizing="dynamic" class="w-full">
          <textarea matInput [rows]="i.pergunta ? 3 : 2" [(ngModel)]="resposta" (ngModelChange)="guardarRascunho()"
                    [placeholder]="i.pergunta ? 'Opcional. Se responder, o roteiro conta a sua história; em branco, sai com um exemplo típico do assunto.' : 'Uma história, um cliente, um número que você quer usar.'"></textarea>
        </mat-form-field>
        <div class="mt-3 flex flex-wrap items-center gap-2">
          @if (i.roteiroApi) {
            <button mat-flat-button (click)="gerar()" [disabled]="ocupado()">
              <mat-icon [class.animate-spin]="ocupado()">{{ ocupado() ? 'progress_activity' : 'auto_awesome' }}</mat-icon>
              {{ ocupado() ? 'Escrevendo… (uns 20 a 40s)' : i.roteiros.length ? 'Gerar nova versão' : 'Gerar roteiro' }}
            </button>
          } @else {
            <button mat-stroked-button (click)="copiarPrompt()"><mat-icon>content_copy</mat-icon>Copiar prompt</button>
          }
        </div>
        @if (!i.roteiroApi) {
          <details class="mt-3">
            <summary class="cursor-pointer text-[13px] text-apagado">Sem chave de API: cole aqui a resposta da IA</summary>
            <mat-form-field appearance="outline" subscriptSizing="dynamic" class="mt-2 w-full"><textarea matInput rows="5" [(ngModel)]="colado" placeholder="Cole o bloco json que a IA devolveu"></textarea></mat-form-field>
            <button mat-flat-button class="!mt-2" (click)="salvarColado()">Salvar roteiro</button>
          </details>
        }
      </div>
    </section>
  `,
})
export class Roteiro {
  readonly ideia = input.required<IdeiaDetalhe>()
  /** pede ao detalhe para buscar a ideia de novo */
  readonly mudou = output<void>()

  private readonly estado = inject(Estado)
  private readonly avisos = inject(MatSnackBar)

  protected readonly versao = signal<number | null>(null)
  protected readonly editando = signal(false)
  protected readonly ocupado = signal(false)
  protected readonly erro = signal<string | null>(null)
  protected readonly letraGrande = signal(false)
  protected readonly confirmaApagar = signal(false)
  protected resposta = ''
  protected pedido = ''
  protected colado = ''
  protected ed: Edicao = this.edicaoVazia()

  protected readonly dataHora = dataHora
  protected readonly trechos = trechos
  protected readonly limpar = limparFala

  protected readonly atual = computed<RoteiroRow | null>(() => {
    const rs = this.ideia().roteiros
    return rs.find((r) => r.versao === this.versao()) ?? rs[0] ?? null
  })
  protected readonly grava = computed(() => {
    const r = this.atual()
    return r ? ehGravado(r.conteudo) : true
  })
  protected readonly peca = computed(() => {
    const r = this.atual()
    return r ? pecaDe(r.conteudo) : 'reels'
  })
  protected readonly falas = computed(() => paragrafos(limparFala(this.atual()?.conteudo.fala ?? '')))
  protected readonly nomeCreator = computed(() => this.estado.persona()?.nome ?? 'o creator')
  protected readonly tituloFala = computed(() => {
    const c = this.atual()?.conteudo
    if (!c) return ''
    const base = this.grava() ? 'Roteiro' : this.peca() === 'foto' ? 'Texto' : 'Texto dos slides'
    return [base, c.formato || null, this.grava() && c.duracao_s ? `~${Math.round(c.duracao_s)}s` : null].filter(Boolean).join(' · ')
  })
  /** num carrossel so ha audio se for uma musica de verdade */
  protected readonly audio = computed(() => {
    const c = this.atual()?.conteudo
    if (!c) return null
    const a = c.audio
    const tem = this.grava() ? a.nome || a.tipo || a.nota : a.nome && a.tipo !== 'voz' && a.tipo !== 'nenhum'
    if (!tem) return null
    const tipo = a.tipo === 'voz' || (!a.nome && !a.tipo) ? 'sua voz' : a.tipo || 'música'
    return a.nome ? `${tipo} · ${a.nome}` : tipo
  })

  ngOnInit(): void {
    const i = this.ideia()
    this.resposta = rascunhos.get(i.id) ?? i.roteiros[0]?.resposta ?? ''
  }

  protected guardarRascunho(): void {
    rascunhos.set(this.ideia().id, this.resposta)
  }

  protected dicaVersao(r: RoteiroRow): string {
    return [dataHora(r.createdAt), r.pedido ? `ajuste: ${r.pedido}` : null].filter(Boolean).join(' · ')
  }

  protected async gerar(pedido = ''): Promise<void> {
    const i = this.ideia()
    this.ocupado.set(true)
    try {
      const r = await this.estado.acao<{ versao: number }>('roteiro.gerar', { id: i.id, resposta: this.resposta, pedido }, false)
      this.versao.set(r.versao)
      rascunhos.delete(i.id)
      this.erro.set(null)
      this.pedido = ''
      this.aviso(`Roteiro v${r.versao} pronto.`)
      this.terminou()
    } catch (e) {
      this.erro.set((e as Error).message)
      this.aviso((e as Error).message)
    } finally {
      this.ocupado.set(false)
    }
  }

  protected ajustar(): void {
    const p = this.pedido.trim()
    if (!p) return this.aviso('Escreva o ajuste que você quer.')
    void this.gerar(p)
  }

  protected async copiarPrompt(): Promise<void> {
    try {
      const r = await this.estado.acao<{ prompt: string; tokens: number }>('roteiro.prompt', { id: this.ideia().id, resposta: this.resposta }, false)
      await navigator.clipboard.writeText(r.prompt)
      this.aviso(`Prompt copiado (~${r.tokens} tokens). Cole numa conversa e traga a resposta.`)
    } catch (e) {
      this.aviso((e as Error).message)
    }
  }

  protected async salvarColado(): Promise<void> {
    try {
      const r = await this.estado.acao<{ versao: number }>('roteiro.colar', { id: this.ideia().id, resposta: this.resposta, texto: this.colado }, false)
      this.versao.set(r.versao)
      this.colado = ''
      this.terminou()
    } catch (e) {
      this.aviso((e as Error).message)
    }
  }

  protected async copiar(r: RoteiroRow): Promise<void> {
    try {
      await navigator.clipboard.writeText(r.texto || r.textoPadrao)
      this.aviso('Roteiro copiado.')
    } catch {
      this.aviso('Não deu para copiar: use Editar e copie do campo.')
    }
  }

  protected async status(r: RoteiroRow, status: 'gravado' | 'rascunho'): Promise<void> {
    try {
      await this.estado.acao('roteiro.status', { roteiro: r.id, status }, false)
      this.terminou()
    } catch (e) {
      this.aviso((e as Error).message)
    }
  }

  /** dois cliques: o primeiro so pergunta */
  protected async apagar(): Promise<void> {
    if (!this.confirmaApagar()) {
      this.confirmaApagar.set(true)
      setTimeout(() => this.confirmaApagar.set(false), 5000)
      return
    }
    const i = this.ideia()
    try {
      const r = await this.estado.acao<{ apagados: number }>('roteiro.apagar', { id: i.id }, false)
      this.versao.set(null)
      this.confirmaApagar.set(false)
      rascunhos.delete(i.id)
      this.resposta = ''
      this.erro.set(null)
      this.aviso(`${r.apagados} ${r.apagados === 1 ? 'versão apagada' : 'versões apagadas'}.`)
      this.terminou()
    } catch (e) {
      this.aviso((e as Error).message)
    }
  }

  protected abrirEditor(r: RoteiroRow): void {
    const c = r.conteudo
    this.ed = {
      gravacao: c.gravacao ?? '',
      audioTipo: c.audio?.tipo && c.audio.tipo !== 'nenhum' ? c.audio.tipo : 'voz',
      audioNome: c.audio?.nome ?? '',
      tom: c.tom ?? '',
      fala: limparFala(c.fala ?? ''),
      formato: c.formato ?? '',
      duracao: c.duracao_s,
      tela: [...(c.tela ?? [])],
      outras: c.ganchos.slice(1).map((g) => g.texto),
      legenda: c.legenda ?? '',
      lembretes: [...(c.lembretes ?? [])],
    }
    this.editando.set(true)
  }

  protected async salvarEdicao(r: RoteiroRow): Promise<void> {
    const e = this.ed
    const fala = e.fala.trim()
    // a abertura usada e a primeira frase da fala; as outras sao alternativas
    const primeira = (fala.match(/^[^\n.!?]*[.!?]?/) ?? [''])[0].trim()
    const conteudo: Partial<RoteiroConteudo> = {
      gravacao: e.gravacao.trim(),
      audio: this.grava() ? { tipo: e.audioTipo, nome: e.audioNome.trim(), nota: '' } : { tipo: 'nenhum', nome: '', nota: '' },
      tom: e.tom.trim(),
      fala,
      formato: e.formato.trim(),
      duracao_s: e.duracao ? Number(e.duracao) : null,
      tela: e.tela,
      ganchos: [primeira, ...e.outras].filter(Boolean).map((texto) => ({ texto, entonacao: '' })),
      legenda: e.legenda.trim(),
      lembretes: e.lembretes,
    }
    this.ocupado.set(true)
    try {
      const res = await this.estado.acao<{ versao: number }>('roteiro.salvar', { id: this.ideia().id, roteiro: r.id, conteudo }, false)
      this.versao.set(res.versao)
      this.editando.set(false)
      this.aviso(`Salvo como v${res.versao}.`)
      this.terminou()
    } catch (err) {
      this.aviso((err as Error).message)
    } finally {
      this.ocupado.set(false)
    }
  }

  private terminou(): void {
    this.mudou.emit()
    void this.estado.carregar()
  }

  private edicaoVazia(): Edicao {
    return { gravacao: '', audioTipo: 'voz', audioNome: '', tom: '', fala: '', formato: '', duracao: null, tela: [], outras: [], legenda: '', lembretes: [] }
  }

  private aviso(msg: string): void {
    this.avisos.open(msg, 'OK', { duration: 4000 })
  }
}
