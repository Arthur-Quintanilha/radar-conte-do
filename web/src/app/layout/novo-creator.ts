import { Component, inject, signal } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { Router } from '@angular/router'
import { MatButtonModule } from '@angular/material/button'
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatInputModule } from '@angular/material/input'
import { MatSnackBar } from '@angular/material/snack-bar'
import { Estado } from '../core/estado'

/** Novo creator: so nome e @. Qualquer pessoa cria os seus; a entrevista e o territorio ficam na tela Creator. */
@Component({
  selector: 'app-novo-creator',
  imports: [FormsModule, MatButtonModule, MatDialogModule, MatFormFieldModule, MatInputModule],
  template: `
    <form (ngSubmit)="criar()">
      <h2 mat-dialog-title>Novo creator</h2>
      <mat-dialog-content class="flex flex-col gap-1 !pt-2">
        <mat-form-field appearance="outline">
          <mat-label>Nome</mat-label>
          <input matInput name="nome" [(ngModel)]="nome" required maxlength="60" placeholder="ex.: Lucas" cdkFocusInitial />
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>&#64; do Instagram (opcional)</mat-label>
          <input matInput name="handle" [(ngModel)]="handle" maxlength="40" placeholder="@usuario" />
        </mat-form-field>
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button type="button" mat-dialog-close>Cancelar</button>
        <button mat-flat-button type="submit" [disabled]="ocupado() || !nome.trim()">Criar creator</button>
      </mat-dialog-actions>
    </form>
  `,
})
export class NovoCreator {
  private readonly ref = inject(MatDialogRef<NovoCreator>)
  private readonly estado = inject(Estado)
  private readonly router = inject(Router)
  private readonly avisos = inject(MatSnackBar)
  protected nome = ''
  protected handle = ''
  protected readonly ocupado = signal(false)

  protected async criar(): Promise<void> {
    const nome = this.nome.trim()
    if (!nome) return
    this.ocupado.set(true)
    try {
      // o servidor ja deixa o novo creator escolhido para quem criou
      await this.estado.acao('persona.criar', { nome, handle: this.handle.trim() }, false)
      this.estado.esquecerFiltro()
      await this.estado.carregar()
      this.ref.close()
      await this.router.navigateByUrl('/creator')
      this.avisos.open(`${nome} criado. Agora responda a entrevista e gere o território.`, 'OK', { duration: 6000 })
    } catch (e) {
      this.avisos.open((e as Error).message, 'OK', { duration: 6000 })
      this.ocupado.set(false)
    }
  }
}
