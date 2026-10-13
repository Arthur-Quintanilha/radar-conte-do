import { Component, computed, inject, signal } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { MatButtonModule } from '@angular/material/button'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatIconModule } from '@angular/material/icon'
import { MatInputModule } from '@angular/material/input'
import { MatMenuModule } from '@angular/material/menu'
import { MatProgressBarModule } from '@angular/material/progress-bar'
import { MatSelectModule } from '@angular/material/select'
import { MatSlideToggleModule } from '@angular/material/slide-toggle'
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar'
import { MatTooltipModule } from '@angular/material/tooltip'
import { Api, type Papel, type PersonaCurta, type UsuarioAdmin } from '../core/api'
import { Estado } from '../core/estado'

/** Senha inicial legivel: 12 caracteres sem os que se confundem (0/O, 1/l). */
function gerarSenha(): string {
  const c = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const n = crypto.getRandomValues(new Uint32Array(12))
  return Array.from(n, (x) => c[x % c.length]).join('')
}

interface Novo {
  nome: string
  email: string
  senha: string
  papel: Papel
  personas: string[]
}

const vazio = (): Novo => ({ nome: '', email: '', senha: gerarSenha(), papel: 'membro', personas: [] })

/**
 * Cadastro de quem entra na versao web. Nao ha cadastro aberto: o admin cria
 * o login com uma senha inicial e diz que creators cada pessoa ve.
 */
@Component({
  selector: 'app-admin',
  imports: [
    FormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatMenuModule,
    MatProgressBarModule,
    MatSelectModule,
    MatSlideToggleModule,
    MatSnackBarModule,
    MatTooltipModule,
  ],
  template: `
    @if (carregando()) { <mat-progress-bar mode="indeterminate" class="mb-4" /> }
    @if (erro(); as e) {
      <div class="mb-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">{{ e }}</div>
    }

    <div class="mb-5 flex flex-wrap items-center gap-3">
      <p class="m-0 min-w-60 flex-1 text-sm text-apagado">
        {{ usuarios().length }} {{ usuarios().length === 1 ? 'pessoa' : 'pessoas' }} com acesso. Admin vê todos os creators; membro vê só os marcados.
      </p>
      @if (!criando()) {
        <button mat-flat-button (click)="abrirNovo()"><mat-icon>person_add</mat-icon>Novo usuário</button>
      }
    </div>

    @if (criando()) {
      <form class="mb-6 rounded-xl border border-linha bg-cartao p-5" (ngSubmit)="criar()">
        <h2 class="m-0 mb-4 text-[17px] font-semibold">Novo usuário</h2>
        <div class="grid gap-x-4 sm:grid-cols-2">
          <mat-form-field appearance="outline">
            <mat-label>Nome</mat-label>
            <input matInput name="nome" [(ngModel)]="novo.nome" autocomplete="off" />
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>E-mail</mat-label>
            <input matInput name="email" type="email" required [(ngModel)]="novo.email" autocomplete="off" />
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Senha inicial</mat-label>
            <input matInput name="senha" required minlength="8" [(ngModel)]="novo.senha" autocomplete="new-password" />
            <button mat-icon-button matSuffix type="button" (click)="novo.senha = gerar()" matTooltip="Gerar outra"><mat-icon>casino</mat-icon></button>
            <mat-hint>Passe para a pessoa; ela pode trocar depois em "Esqueci a senha".</mat-hint>
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Papel</mat-label>
            <mat-select name="papel" [(ngModel)]="novo.papel">
              <mat-option value="membro">Membro</mat-option>
              <mat-option value="admin">Admin</mat-option>
            </mat-select>
          </mat-form-field>
          <mat-form-field appearance="outline" class="sm:col-span-2">
            <mat-label>Creators que pode ver</mat-label>
            <mat-select name="personas" multiple [(ngModel)]="novo.personas" [disabled]="novo.papel === 'admin'">
              @for (p of personas(); track p.id) { <mat-option [value]="p.id">{{ rotulo(p) }}</mat-option> }
            </mat-select>
            @if (novo.papel === 'admin') { <mat-hint>Admin vê todos.</mat-hint> }
          </mat-form-field>
        </div>
        <div class="mt-2 flex justify-end gap-2">
          <button mat-button type="button" (click)="criando.set(false)">Cancelar</button>
          <button mat-flat-button type="submit" [disabled]="salvando()">Criar</button>
        </div>
      </form>
    }

    @if (criado(); as c) {
      <div class="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-emerald-300 bg-emerald-50 px-5 py-4 text-sm text-emerald-900">
        <mat-icon>check_circle</mat-icon>
        <span class="flex-1">Login criado. Envie para a pessoa: <b>{{ c.email }}</b> · senha <b class="font-mono">{{ c.senha }}</b></span>
        <button mat-stroked-button (click)="copiar(c)"><mat-icon>content_copy</mat-icon>Copiar</button>
        <button mat-icon-button (click)="criado.set(null)" aria-label="Fechar"><mat-icon>close</mat-icon></button>
      </div>
    }

    <div class="flex flex-col gap-3">
      @for (u of usuarios(); track u.id) {
        <article class="rounded-xl border border-linha bg-cartao p-4" [class.opacity-60]="!u.ativo">
          <div class="flex flex-wrap items-center gap-3">
            <span class="grid size-10 shrink-0 place-items-center rounded-full bg-marca-suave font-bold text-marca">{{ inicial(u) }}</span>
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2">
                <b class="truncate">{{ u.nome || u.email }}</b>
                @if (u.id === meuId()) { <span class="rounded-full bg-black/5 px-2 py-0.5 text-xs text-apagado">você</span> }
                @if (!u.ativo) { <span class="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-800">desativado</span> }
              </div>
              @if (u.nome) { <div class="truncate text-sm text-apagado">{{ u.email }}</div> }
            </div>

            <div class="order-last flex w-full gap-2 md:order-none md:w-auto">
              <mat-form-field appearance="outline" subscriptSizing="dynamic" class="campo-compacto w-32 shrink-0">
                <mat-select [value]="u.papel" (selectionChange)="salvar(u, { papel: $event.value })" [disabled]="u.id === meuId()" aria-label="Papel">
                  <mat-option value="membro">Membro</mat-option>
                  <mat-option value="admin">Admin</mat-option>
                </mat-select>
              </mat-form-field>

              <mat-form-field appearance="outline" subscriptSizing="dynamic" class="campo-compacto min-w-0 flex-1 md:w-60 md:flex-none">
                @if (u.papel === 'admin') {
                  <mat-select [value]="'todos'" disabled aria-label="Creators"><mat-option value="todos">Todos os creators</mat-option></mat-select>
                } @else {
                  <mat-select multiple [value]="u.personas" placeholder="Nenhum creator" aria-label="Creators" (openedChange)="!$event && salvarCreators(u, sel.value)" #sel>
                    <mat-select-trigger>{{ resumoCreators(sel.value ?? u.personas) }}</mat-select-trigger>
                    @for (p of personas(); track p.id) { <mat-option [value]="p.id">{{ rotulo(p) }}</mat-option> }
                  </mat-select>
                }
              </mat-form-field>
            </div>

            <mat-slide-toggle [checked]="u.ativo" (change)="salvar(u, { ativo: $event.checked })" [disabled]="u.id === meuId()"
                              [matTooltip]="u.ativo ? 'Desativar o login' : 'Reativar o login'" aria-label="Ativo" />

            <button mat-icon-button [matMenuTriggerFor]="mais" aria-label="Mais"><mat-icon>more_vert</mat-icon></button>
            <mat-menu #mais="matMenu">
              <button mat-menu-item (click)="abrirSenha(u)"><mat-icon>key</mat-icon><span>Trocar senha</span></button>
              <button mat-menu-item (click)="abrirNome(u)"><mat-icon>edit</mat-icon><span>Editar nome</span></button>
            </mat-menu>
          </div>

          @if (editando()?.id === u.id) {
            <form class="mt-3 flex flex-wrap items-start gap-2 border-t border-linha pt-3" (ngSubmit)="aplicarEdicao(u)">
              <mat-form-field appearance="outline" subscriptSizing="dynamic" class="min-w-64 flex-1">
                <mat-label>{{ editando()!.campo === 'senha' ? 'Nova senha' : 'Nome' }}</mat-label>
                <input matInput name="valor" [(ngModel)]="valorEdicao" [attr.autocomplete]="editando()!.campo === 'senha' ? 'new-password' : 'off'" />
                @if (editando()!.campo === 'senha') {
                  <button mat-icon-button matSuffix type="button" (click)="valorEdicao = gerar()" matTooltip="Gerar"><mat-icon>casino</mat-icon></button>
                }
              </mat-form-field>
              <button mat-button type="button" class="!mt-2" (click)="editando.set(null)">Cancelar</button>
              <button mat-flat-button type="submit" class="!mt-2" [disabled]="salvando()">Salvar</button>
            </form>
          }
        </article>
      }
    </div>
  `,
})
export class Admin {
  private readonly api = inject(Api)
  private readonly estado = inject(Estado)
  private readonly avisos = inject(MatSnackBar)

  protected readonly usuarios = signal<UsuarioAdmin[]>([])
  protected readonly personas = signal<PersonaCurta[]>([])
  protected readonly carregando = signal(false)
  protected readonly salvando = signal(false)
  protected readonly erro = signal<string | null>(null)
  protected readonly criando = signal(false)
  protected readonly criado = signal<{ email: string; senha: string } | null>(null)
  protected readonly editando = signal<{ id: string; campo: 'senha' | 'nome' } | null>(null)
  protected readonly meuId = computed(() => this.estado.eu()?.id)
  protected novo: Novo = vazio()
  protected valorEdicao = ''
  protected readonly gerar = gerarSenha

  constructor() {
    void this.carregar()
  }

  protected async carregar(): Promise<void> {
    this.carregando.set(true)
    try {
      const r = await this.api.usuarios()
      this.usuarios.set(r.usuarios)
      this.personas.set(r.personas)
      this.erro.set(null)
    } catch (e) {
      this.erro.set((e as Error).message)
    } finally {
      this.carregando.set(false)
    }
  }

  protected abrirNovo(): void {
    this.novo = vazio()
    this.criado.set(null)
    this.criando.set(true)
  }

  protected async criar(): Promise<void> {
    const n = this.novo
    if (!n.email.trim()) return this.aviso('Preencha o e-mail.')
    if (n.senha.length < 8) return this.aviso('A senha precisa de pelo menos 8 caracteres.')
    this.salvando.set(true)
    try {
      await this.api.criarUsuario({ ...n, nome: n.nome.trim() || undefined, personas: n.papel === 'admin' ? [] : n.personas })
      this.criado.set({ email: n.email.trim().toLowerCase(), senha: n.senha })
      this.criando.set(false)
      await this.carregar()
    } catch (e) {
      this.aviso((e as Error).message)
    } finally {
      this.salvando.set(false)
    }
  }

  protected async salvar(u: UsuarioAdmin, dados: Parameters<Api['editarUsuario']>[1], msg = 'Salvo.'): Promise<void> {
    this.salvando.set(true)
    try {
      await this.api.editarUsuario(u.id, dados)
      this.aviso(msg)
    } catch (e) {
      this.aviso((e as Error).message)
    } finally {
      this.salvando.set(false)
      await this.carregar()
    }
  }

  protected salvarCreators(u: UsuarioAdmin, ids: string[] | null): void {
    const novos = [...(ids ?? [])].sort()
    if (novos.join() === [...u.personas].sort().join()) return
    void this.salvar(u, { personas: novos }, 'Creators atualizados.')
  }

  protected abrirSenha(u: UsuarioAdmin): void {
    this.valorEdicao = gerarSenha()
    this.editando.set({ id: u.id, campo: 'senha' })
  }

  protected abrirNome(u: UsuarioAdmin): void {
    this.valorEdicao = u.nome ?? ''
    this.editando.set({ id: u.id, campo: 'nome' })
  }

  protected async aplicarEdicao(u: UsuarioAdmin): Promise<void> {
    const e = this.editando()
    if (!e) return
    if (e.campo === 'senha') {
      if (this.valorEdicao.length < 8) return this.aviso('A senha precisa de pelo menos 8 caracteres.')
      const senha = this.valorEdicao
      await this.salvar(u, { senha }, 'Senha trocada.')
      this.criado.set({ email: u.email, senha })
    } else {
      await this.salvar(u, { nome: this.valorEdicao.trim() || null })
    }
    this.editando.set(null)
  }

  protected async copiar(c: { email: string; senha: string }): Promise<void> {
    const texto = `Acesso ao Radar de conteúdo\nE-mail: ${c.email}\nSenha: ${c.senha}\nLink: ${location.origin}`
    try {
      await navigator.clipboard.writeText(texto)
      this.aviso('Copiado.')
    } catch {
      this.aviso('Não consegui copiar: selecione o texto à mão.')
    }
  }

  protected rotulo(p: PersonaCurta): string {
    return p.handle ? `${p.nome} (@${p.handle})` : p.nome
  }

  protected resumoCreators(ids: string[]): string {
    if (!ids?.length) return 'Nenhum creator'
    const nomes = ids.map((id) => this.personas().find((p) => p.id === id)?.nome ?? '?')
    return nomes.length <= 2 ? nomes.join(', ') : `${nomes.length} creators`
  }

  protected inicial(u: UsuarioAdmin): string {
    return (u.nome || u.email).trim().charAt(0).toUpperCase()
  }

  private aviso(msg: string): void {
    this.avisos.open(msg, 'OK', { duration: 4000 })
  }
}
