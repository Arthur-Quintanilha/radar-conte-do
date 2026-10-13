import { Component, computed, inject, signal } from '@angular/core'
import { Router, RouterLink, RouterLinkActive, RouterOutlet, NavigationEnd } from '@angular/router'
import { MatButtonModule } from '@angular/material/button'
import { MatIconModule } from '@angular/material/icon'
import { MatMenuModule } from '@angular/material/menu'
import { MatDividerModule } from '@angular/material/divider'
import { MatTooltipModule } from '@angular/material/tooltip'
import { Execucao, ETAPAS } from '../core/execucao'
import { Log } from './log'
import { NovoCreator } from './novo-creator'
import { MatDialog } from '@angular/material/dialog'
import { MatSnackBar } from '@angular/material/snack-bar'
import { filter } from 'rxjs'
import { Auth } from '../core/auth'
import { Estado } from '../core/estado'

interface Item {
  rota: string
  rotulo: string
  icone: string
  soAdmin?: boolean
}

/** Menu lateral, barra do topo (creator e conta) e a area das telas. */
@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, MatButtonModule, MatIconModule, MatMenuModule, MatDividerModule, MatTooltipModule, Log],
  template: `
    <div class="flex min-h-dvh bg-fundo text-tinta">
      <aside class="hidden w-64 shrink-0 flex-col gap-1 border-r border-linha bg-cartao px-3 py-5 md:flex" [class.!flex]="menuAberto()">
        <div class="mb-4 flex items-center gap-2 px-3">
          <span class="grid size-8 place-items-center rounded-lg bg-marca text-white"><mat-icon class="!size-5 !text-[20px]">radar</mat-icon></span>
          <b class="text-[15px]">Radar de conteúdo</b>
        </div>
        @for (i of visiveis(); track i.rota) {
          <a [routerLink]="i.rota" routerLinkActive="!bg-marca-suave !text-marca" (click)="menuAberto.set(false)"
             class="flex items-center gap-3 rounded-lg px-3 py-2 text-[15px] font-medium text-apagado no-underline transition-colors hover:bg-black/5">
            <mat-icon class="!size-5 !text-[20px]">{{ i.icone }}</mat-icon>{{ i.rotulo }}
          </a>
        }
      </aside>

      <div class="flex min-w-0 flex-1 flex-col">
        <header class="flex items-center gap-3 border-b border-linha bg-fundo/90 px-4 py-3 backdrop-blur md:px-8">
          <button mat-icon-button class="md:!hidden" (click)="menuAberto.set(!menuAberto())" aria-label="Menu"><mat-icon>menu</mat-icon></button>
          <h1 class="m-0 flex-1 truncate text-xl font-bold">{{ titulo() }}</h1>

          <div class="flex">
            <button mat-flat-button class="!rounded-r-none" (click)="ex.rodar('semana')" [disabled]="ex.rodando() || !estado.persona()"
                    matTooltip="Visita as contas, transcreve, avalia os posts e acrescenta ideias à pauta. Abre o Chrome na máquina do servidor.">
              <mat-icon [class.animate-spin]="ex.rodando()">{{ ex.rodando() ? 'progress_activity' : 'travel_explore' }}</mat-icon>
              <span class="hidden sm:inline">{{ ex.rodando() ? 'Rodando…' : 'Buscar ideias' }}</span>
            </button>
            <button mat-flat-button class="!min-w-0 !rounded-l-none !border-l !border-white/30 !px-2" [matMenuTriggerFor]="menuEtapas" aria-label="Outras etapas">
              <mat-icon class="!m-0">expand_more</mat-icon>
            </button>
          </div>
          <mat-menu #menuEtapas="matMenu" xPosition="before">
            <div class="flex items-center gap-3 px-4 py-2" (click)="$event.stopPropagation()" (keydown)="$event.stopPropagation()">
              <div class="flex-1 text-sm"><b class="block">Mínimo de ideias</b><span class="text-xs text-apagado">vazio: a IA decide quantas</span></div>
              <input type="number" min="1" max="50" inputmode="numeric" placeholder="—" [value]="ex.minimo() ?? ''" (input)="ex.definirMinimo($any($event.target).value)"
                     class="w-16 rounded-md border border-linha bg-white px-2 py-1 text-center" aria-label="Mínimo de ideias" />
            </div>
            <mat-divider />
            @for (e of etapas; track e.cmd) {
              <button mat-menu-item (click)="ex.rodar(e.cmd)" [disabled]="ex.rodando() || !estado.persona()">
                <span class="flex flex-col leading-tight"><b class="text-sm">{{ e.rotulo }}</b><span class="text-xs text-apagado">{{ e.detalhe }}</span></span>
              </button>
            }
            <mat-divider />
            <button mat-menu-item (click)="ex.mostrarLog('aberto')" [disabled]="!ex.job()"><mat-icon>terminal</mat-icon><span>Ver o log</span></button>
          </mat-menu>

          <button mat-stroked-button [matMenuTriggerFor]="menuCreator" class="!rounded-full">
            <span class="mr-1 inline-grid size-6 place-items-center rounded-full bg-marca text-xs font-bold text-white">{{ inicial(estado.persona()?.nome) }}</span>
            {{ estado.persona()?.nome ?? 'Creator' }}
            <mat-icon iconPositionEnd>expand_more</mat-icon>
          </button>
          <mat-menu #menuCreator="matMenu">
            @for (p of estado.personas(); track p.id) {
              <button mat-menu-item (click)="trocar(p.id)">
                <mat-icon>{{ p.id === estado.persona()?.id ? 'check' : 'person' }}</mat-icon>
                <span>{{ p.nome }}</span>
              </button>
            }
            <mat-divider />
            <button mat-menu-item (click)="novoCreator()"><mat-icon>add</mat-icon><span>Novo creator</span></button>
          </mat-menu>

          <button mat-icon-button [matMenuTriggerFor]="menuConta" aria-label="Conta"><mat-icon>account_circle</mat-icon></button>
          <mat-menu #menuConta="matMenu">
            <div class="px-4 py-2 text-sm text-apagado">{{ auth.usuario()?.email }}</div>
            <mat-divider />
            <button mat-menu-item (click)="sair()"><mat-icon>logout</mat-icon><span>Sair</span></button>
          </mat-menu>
        </header>

        <main class="mx-auto w-full max-w-6xl flex-1 px-4 py-6 md:px-8">
          @if (estado.erro(); as e) {
            <div class="mb-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">{{ e }}</div>
          }
          <router-outlet />
        </main>
      </div>
    </div>
    <app-log />
  `,
})
export class Shell {
  protected readonly auth = inject(Auth)
  protected readonly estado = inject(Estado)
  protected readonly ex = inject(Execucao)
  protected readonly etapas = ETAPAS
  private readonly router = inject(Router)

  protected readonly itens: Item[] = [
    { rota: '/pauta', rotulo: 'Pauta', icone: 'lightbulb' },
    { rota: '/creator', rotulo: 'Creator', icone: 'person' },
    { rota: '/sementes', rotulo: 'Sementes e referências', icone: 'hub' },
    { rota: '/admin', rotulo: 'Administração', icone: 'admin_panel_settings', soAdmin: true },
  ]
  protected readonly visiveis = computed(() => this.itens.filter((i) => !i.soAdmin || this.estado.admin()))
  protected readonly menuAberto = signal(false)
  private readonly url = signal(this.router.url)
  protected readonly titulo = computed(() => this.itens.find((i) => this.url().startsWith(i.rota))?.rotulo ?? '')

  constructor() {
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe((e) => this.url.set((e as NavigationEnd).urlAfterRedirects))
    void this.estado.carregarEu()
    void this.estado.carregar()
  }

  private readonly dialogo = inject(MatDialog)
  private readonly avisos = inject(MatSnackBar)

  protected novoCreator(): void {
    if (this.ex.rodando()) {
      this.avisos.open('Espere a etapa que está rodando terminar antes de criar outro creator.', 'OK', { duration: 5000 })
      return
    }
    this.dialogo.open(NovoCreator, { width: '440px', maxWidth: '94vw' })
  }

  protected async trocar(id: string): Promise<void> {
    if (id === this.estado.persona()?.id) return
    await this.estado.trocarPersona(id)
    this.avisos.open(`Agora você está em ${this.estado.persona()?.nome ?? 'outro creator'}.`, 'OK', { duration: 3000 })
  }

  protected inicial(nome?: string | null): string {
    return (nome ?? '?').trim().charAt(0).toUpperCase()
  }

  protected async sair(): Promise<void> {
    await this.auth.sair()
    await this.router.navigateByUrl('/entrar')
  }
}
