import { Component, ElementRef, afterNextRender, inject, signal, viewChild } from '@angular/core'
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog'
import { MatButtonModule } from '@angular/material/button'
import { MatIconModule } from '@angular/material/icon'
import { MatProgressBarModule } from '@angular/material/progress-bar'
import { MatSnackBar } from '@angular/material/snack-bar'
import { Api, type IdeiaDetalhe } from '../core/api'
import { Estado } from '../core/estado'
import { dataLonga, nomeFormato } from '../core/formato'
import { PostBloco } from './post-bloco'
import { Respostas } from './respostas'
import { Roteiro } from './roteiro'

export interface DadosDetalhe {
  id: string
  /** abre ja rolado ate o roteiro */
  irRoteiro?: boolean
}

/** Detalhe de uma ideia: cabecalho fixo, o resto rola. Pauta tem roteiro; radar mostra os exemplos. */
@Component({
  selector: 'app-detalhe',
  imports: [MatDialogModule, MatButtonModule, MatIconModule, MatProgressBarModule, PostBloco, Respostas, Roteiro],
  template: `
    <div class="flex max-h-[92dvh] flex-col">
      <header class="flex items-start gap-3 border-b border-linha px-5 py-4 md:px-7">
        <div class="min-w-0 flex-1">
          <p class="m-0 text-xs font-semibold tracking-wide text-marca uppercase">
            {{ ideia()?.tipo === 'radar' ? 'Radar' : 'Pauta' }}@if (ideia()?.createdAt) { · sugerida em {{ dataLonga(ideia()!.createdAt) }}}
          </p>
          <h2 class="m-0 mt-1 text-xl leading-snug font-bold">{{ ideia()?.titulo ?? 'Carregando…' }}</h2>
        </div>
        <button mat-icon-button (click)="ref.close()" aria-label="Fechar"><mat-icon>close</mat-icon></button>
      </header>
      @if (carregando()) { <mat-progress-bar mode="indeterminate" /> }

      <div #corpo class="min-h-0 flex-1 overflow-y-auto px-5 py-5 md:px-7">
        @if (erro(); as e) { <p class="text-red-800">{{ e }}</p> }
        @if (ideia(); as i) {
          <div class="flex flex-col gap-5">
            @if (i.tipo === 'radar') {
              @if (i.porQue) { <p class="m-0">{{ i.porQue }}</p> }
              <app-respostas [id]="i.id" tipo="radar" [status]="i.status" (respondeu)="recarregar()" />
              @for (p of i.exemplos; track p.shortcode) {
                <app-post-bloco [post]="p" [rotulo]="'Exemplo ' + ($index + 1)" (virarSemente)="virar('sementes.add', $event)" (virarReferencia)="virar('referencias.add', $event)" />
              }
            } @else {
              @if (i.hook) { <blockquote class="m-0 border-l-4 border-marca pl-4 text-lg italic">“{{ i.hook }}”</blockquote> }
              <dl class="m-0 grid gap-x-6 gap-y-2 text-[15px] sm:grid-cols-[180px_1fr]">
                @if (i.angulo) { <dt class="font-semibold text-apagado">Seu ângulo</dt><dd class="m-0">{{ i.angulo }}</dd> }
                @if (i.formato) { <dt class="font-semibold text-apagado">Formato</dt><dd class="m-0">{{ nomeFormato(i.formato) }}</dd> }
                @if (i.porQue) { <dt class="font-semibold text-apagado">Por que o público assiste</dt><dd class="m-0">{{ i.porQue }}</dd> }
              </dl>
              <app-respostas [id]="i.id" [status]="i.status" [motivo]="i.motivo" [notaAtual]="i.nota" (respondeu)="recarregar()" />
              @if (i.status !== 'recusada') { <app-roteiro [ideia]="i" (mudou)="recarregar()" /> }
              @if (i.assunto; as a) {
                <app-post-bloco [post]="a" [rotulo]="i.formatoRef ? 'De onde veio o assunto' : 'Referência (assunto e formato)'"
                                (virarSemente)="virar('sementes.add', $event)" (virarReferencia)="virar('referencias.add', $event)" />
              }
              @if (i.formatoRef; as f) {
                <app-post-bloco [post]="f" rotulo="Formato sugerido (o post do assunto não engajou: use esta forma, não este assunto)"
                                (virarSemente)="virar('sementes.add', $event)" (virarReferencia)="virar('referencias.add', $event)" />
              }
            }
          </div>
        }
      </div>
    </div>
  `,
})
export class Detalhe {
  protected readonly ref = inject(MatDialogRef<Detalhe>)
  private readonly dados = inject<DadosDetalhe>(MAT_DIALOG_DATA)
  private readonly api = inject(Api)
  private readonly estado = inject(Estado)
  private readonly avisos = inject(MatSnackBar)
  private readonly corpo = viewChild<ElementRef<HTMLElement>>('corpo')

  protected readonly ideia = signal<IdeiaDetalhe | null>(null)
  protected readonly carregando = signal(true)
  protected readonly erro = signal<string | null>(null)
  protected readonly dataLonga = dataLonga
  protected readonly nomeFormato = nomeFormato

  constructor() {
    void this.recarregar().then(() => {
      if (this.dados.irRoteiro) setTimeout(() => this.corpo()?.nativeElement.querySelector('#roteiro')?.scrollIntoView({ block: 'start' }), 50)
    })
    afterNextRender(() => this.corpo()?.nativeElement.focus())
  }

  /** busca de novo sem perder a rolagem */
  protected async recarregar(): Promise<void> {
    this.carregando.set(true)
    try {
      this.ideia.set(await this.api.ideia(this.dados.id))
      this.erro.set(null)
    } catch (e) {
      this.erro.set((e as Error).message)
    } finally {
      this.carregando.set(false)
    }
  }

  protected async virar(acao: 'sementes.add' | 'referencias.add', username: string): Promise<void> {
    try {
      await this.estado.acao(acao, { texto: username })
      this.avisos.open(`@${username} ${acao === 'sementes.add' ? 'virou semente' : 'virou referência'}.`, 'OK', { duration: 4000 })
    } catch (e) {
      this.avisos.open((e as Error).message, 'OK', { duration: 6000 })
    }
  }
}
