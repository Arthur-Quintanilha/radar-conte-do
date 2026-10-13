import { Component, input, model, signal } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { MatButtonModule } from '@angular/material/button'
import { MatIconModule } from '@angular/material/icon'
import { MatTooltipModule } from '@angular/material/tooltip'
import type { TemaItem } from '../core/api'

const CAMPO = 'w-full rounded-md border border-linha bg-white px-3 py-2 text-[14px] focus:border-marca focus:outline-none'

/**
 * Lista cadastrada um item por vez: digita, adiciona, e cada item fica numa
 * linha com editar e remover. Substitui os campos de "um por linha".
 */
@Component({
  selector: 'app-lista',
  imports: [FormsModule, MatButtonModule, MatIconModule, MatTooltipModule],
  template: `
    @if (rotulo()) { <div class="mb-2 text-[14px] font-semibold">{{ rotulo() }}</div> }
    @if (itens().length) {
      <ul class="m-0 mb-2 flex list-none flex-col gap-1.5 p-0">
        @for (it of itens(); track $index) {
          <li class="group flex items-start gap-2 rounded-lg border border-linha bg-white px-3 py-2">
            @if (editando() === $index) {
              <textarea [(ngModel)]="rascunho" rows="2" [class]="campo" (keydown.enter)="$event.preventDefault(); salvar($index)" (keydown.escape)="editando.set(null)" aria-label="Editar item"></textarea>
              <button mat-icon-button (click)="salvar($index)" aria-label="Salvar"><mat-icon>check</mat-icon></button>
            } @else {
              <span class="min-w-0 flex-1 py-1 text-[14px] whitespace-pre-line">{{ it }}</span>
              <button mat-icon-button class="!size-8 !p-1 opacity-60 group-hover:opacity-100" (click)="editar($index)" matTooltip="Editar" aria-label="Editar"><mat-icon class="!text-[18px]">edit</mat-icon></button>
              <button mat-icon-button class="!size-8 !p-1 opacity-60 group-hover:opacity-100" (click)="remover($index)" matTooltip="Remover" aria-label="Remover"><mat-icon class="!text-[18px]">close</mat-icon></button>
            }
          </li>
        }
      </ul>
    }
    <div class="flex gap-2">
      <input [(ngModel)]="novo" [placeholder]="dica()" [maxlength]="max()" [class]="campo" (keydown.enter)="$event.preventDefault(); adicionar()" [attr.aria-label]="'Adicionar: ' + (rotulo() || dica())" />
      <button mat-stroked-button class="!h-10 shrink-0" (click)="adicionar()" [disabled]="!novo.trim()"><mat-icon>add</mat-icon>Adicionar</button>
    </div>
  `,
})
export class Lista {
  readonly itens = model<string[]>([])
  readonly rotulo = input('')
  readonly dica = input('')
  readonly max = input(400)

  protected readonly campo = CAMPO
  protected readonly editando = signal<number | null>(null)
  protected novo = ''
  protected rascunho = ''

  protected adicionar(): void {
    const v = this.novo.trim()
    if (!v) return
    this.itens.set([...this.itens(), v])
    this.novo = ''
  }
  protected editar(i: number): void {
    this.rascunho = this.itens()[i] ?? ''
    this.editando.set(i)
  }
  protected salvar(i: number): void {
    const v = this.rascunho.trim()
    this.itens.set(v ? this.itens().map((x, n) => (n === i ? v : x)) : this.itens().filter((_, n) => n !== i))
    this.editando.set(null)
  }
  protected remover(i: number): void {
    this.itens.set(this.itens().filter((_, n) => n !== i))
    if (this.editando() === i) this.editando.set(null)
  }
}

/** O mesmo cadastro, para temas: cada um tem o tema e, opcional, o que o creator tem a dizer sobre ele. */
@Component({
  selector: 'app-lista-temas',
  imports: [FormsModule, MatButtonModule, MatIconModule, MatTooltipModule],
  template: `
    @if (rotulo()) { <div class="mb-2 text-[14px] font-semibold">{{ rotulo() }}</div> }
    @if (itens().length) {
      <ul class="m-0 mb-2 flex list-none flex-col gap-1.5 p-0">
        @for (it of itens(); track $index) {
          <li class="group flex items-start gap-2 rounded-lg border border-linha bg-white px-3 py-2">
            @if (editando() === $index) {
              <div class="flex min-w-0 flex-1 flex-col gap-1.5">
                <input [(ngModel)]="rTema" maxlength="80" placeholder="Tema" [class]="campo" (keydown.enter)="salvar($index)" (keydown.escape)="editando.set(null)" aria-label="Tema" />
                <textarea [(ngModel)]="rDetalhe" rows="2" maxlength="400" [placeholder]="dicaDetalhe()" [class]="campo" (keydown.escape)="editando.set(null)" aria-label="Detalhe"></textarea>
              </div>
              <button mat-icon-button (click)="salvar($index)" aria-label="Salvar"><mat-icon>check</mat-icon></button>
            } @else {
              <div class="min-w-0 flex-1 py-1 text-[14px]">
                <b>{{ it.tema }}</b>
                @if (it.detalhe) { <div class="text-apagado">{{ it.detalhe }}</div> }
              </div>
              <button mat-icon-button class="!size-8 !p-1 opacity-60 group-hover:opacity-100" (click)="editar($index)" matTooltip="Editar" aria-label="Editar"><mat-icon class="!text-[18px]">edit</mat-icon></button>
              <button mat-icon-button class="!size-8 !p-1 opacity-60 group-hover:opacity-100" (click)="remover($index)" matTooltip="Remover" aria-label="Remover"><mat-icon class="!text-[18px]">close</mat-icon></button>
            }
          </li>
        }
      </ul>
    }
    <div class="flex flex-col gap-1.5 rounded-lg border border-dashed border-linha p-2 sm:flex-row">
      <input [(ngModel)]="nTema" maxlength="80" [placeholder]="dica()" [class]="campo + ' sm:w-56 sm:shrink-0'" (keydown.enter)="adicionar()" aria-label="Novo tema" />
      <input [(ngModel)]="nDetalhe" maxlength="400" [placeholder]="dicaDetalhe()" [class]="campo" (keydown.enter)="adicionar()" aria-label="O que tem a dizer (opcional)" />
      <button mat-stroked-button class="!h-10 shrink-0" (click)="adicionar()" [disabled]="!nTema.trim()"><mat-icon>add</mat-icon>Adicionar</button>
    </div>
  `,
})
export class ListaTemas {
  readonly itens = model<TemaItem[]>([])
  readonly rotulo = input('')
  readonly dica = input('Tema')
  readonly dicaDetalhe = input('O que você tem a dizer (opcional)')

  protected readonly campo = CAMPO
  protected readonly editando = signal<number | null>(null)
  protected nTema = ''
  protected nDetalhe = ''
  protected rTema = ''
  protected rDetalhe = ''

  protected adicionar(): void {
    const tema = this.nTema.trim()
    if (!tema) return
    this.itens.set([...this.itens(), { tema, detalhe: this.nDetalhe.trim() }])
    this.nTema = ''
    this.nDetalhe = ''
  }
  protected editar(i: number): void {
    const it = this.itens()[i]
    this.rTema = it?.tema ?? ''
    this.rDetalhe = it?.detalhe ?? ''
    this.editando.set(i)
  }
  protected salvar(i: number): void {
    const tema = this.rTema.trim()
    this.itens.set(tema ? this.itens().map((x, n) => (n === i ? { tema, detalhe: this.rDetalhe.trim() } : x)) : this.itens().filter((_, n) => n !== i))
    this.editando.set(null)
  }
  protected remover(i: number): void {
    this.itens.set(this.itens().filter((_, n) => n !== i))
    if (this.editando() === i) this.editando.set(null)
  }
}
