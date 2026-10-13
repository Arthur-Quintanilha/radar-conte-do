import { Component, inject, signal } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { Router } from '@angular/router'
import { MatButtonModule } from '@angular/material/button'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatInputModule } from '@angular/material/input'
import { MatIconModule } from '@angular/material/icon'
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner'
import { Auth } from '../core/auth'

/** Login com e-mail e senha. Sem cadastro: quem cria usuarios e o admin. */
@Component({
  selector: 'app-entrar',
  imports: [FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatIconModule, MatProgressSpinnerModule],
  template: `
    <div class="grid min-h-dvh place-items-center bg-fundo px-4">
      <form (ngSubmit)="entrar()" class="w-full max-w-sm rounded-2xl border border-linha bg-cartao p-8 shadow-sm">
        <div class="mb-6 flex items-center gap-2">
          <span class="grid size-9 place-items-center rounded-lg bg-marca text-white"><mat-icon>radar</mat-icon></span>
          <b class="text-lg">Radar de conteúdo</b>
        </div>
        <h1 class="m-0 mb-1 text-2xl font-bold">Entrar</h1>
        <p class="m-0 mb-6 text-sm text-apagado">Use o e-mail e a senha que o administrador criou para você.</p>

        <mat-form-field appearance="outline" class="w-full">
          <mat-label>E-mail</mat-label>
          <input matInput type="email" name="email" [(ngModel)]="email" autocomplete="email" required />
        </mat-form-field>
        <mat-form-field appearance="outline" class="w-full">
          <mat-label>Senha</mat-label>
          <input matInput [type]="ver() ? 'text' : 'password'" name="senha" [(ngModel)]="senha" autocomplete="current-password" required />
          <button mat-icon-button matSuffix type="button" (click)="ver.set(!ver())" [attr.aria-label]="ver() ? 'Esconder senha' : 'Mostrar senha'">
            <mat-icon>{{ ver() ? 'visibility_off' : 'visibility' }}</mat-icon>
          </button>
        </mat-form-field>

        @if (erro()) {
          <p class="m-0 mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{{ erro() }}</p>
        }
        @if (aviso()) {
          <p class="m-0 mb-4 rounded-lg bg-marca-suave px-3 py-2 text-sm text-marca">{{ aviso() }}</p>
        }

        <button mat-flat-button type="submit" class="w-full" [disabled]="enviando()">
          @if (enviando()) { <mat-spinner diameter="18" class="mr-2 inline-block" /> } Entrar
        </button>
        <button mat-button type="button" class="mt-2 w-full" (click)="esqueci()" [disabled]="enviando()">Esqueci a senha</button>
      </form>
    </div>
  `,
})
export class Entrar {
  private readonly auth = inject(Auth)
  private readonly router = inject(Router)

  protected email = ''
  protected senha = ''
  protected readonly ver = signal(false)
  protected readonly enviando = signal(false)
  protected readonly erro = signal<string | null>(null)
  protected readonly aviso = signal<string | null>(null)

  protected async entrar(): Promise<void> {
    if (!this.email || !this.senha) return this.erro.set('Preencha e-mail e senha.')
    this.enviando.set(true)
    this.erro.set(null)
    this.aviso.set(null)
    const e = await this.auth.entrar(this.email, this.senha)
    this.enviando.set(false)
    if (e) this.erro.set(e)
    else await this.router.navigateByUrl('/pauta')
  }

  protected async esqueci(): Promise<void> {
    if (!this.email) return this.erro.set('Digite o seu e-mail primeiro.')
    this.enviando.set(true)
    const e = await this.auth.esqueciSenha(this.email)
    this.enviando.set(false)
    if (e) this.erro.set(e)
    else this.aviso.set('Se o e-mail estiver cadastrado, chega um link para criar uma senha nova.')
  }
}
