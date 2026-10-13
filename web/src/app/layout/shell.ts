import { Component, computed, inject, signal } from '@angular/core'
import { Router, RouterLink, RouterLinkActive, RouterOutlet, NavigationEnd } from '@angular/router'
import { MatButtonModule } from '@angular/material/button'
import { MatIconModule } from '@angular/material/icon'
import { MatMenuModule } from '@angular/material/menu'
import { MatDividerModule } from '@angular/material/divider'
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
  imports: [RouterOutlet, RouterLink, RouterLinkActive, MatButtonModule, MatIconModule, MatMenuModule, MatDividerModule],
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
          <h1 class="m-0 flex-1 text-xl font-bold">{{ titulo() }}</h1>

          <button mat-stroked-button [matMenuTriggerFor]="menuCreator" class="!rounded-full">
            <span class="mr-1 inline-grid size-6 place-items-center rounded-full bg-marca text-xs font-bold text-white">{{ inicial(estado.persona()?.nome) }}</span>
            {{ estado.persona()?.nome ?? 'Creator' }}
            <mat-icon iconPositionEnd>expand_more</mat-icon>
          </button>
          <mat-menu #menuCreator="matMenu">
            @for (p of estado.personas(); track p.id) {
              <button mat-menu-item (click)="estado.trocarPersona(p.id)">
                <mat-icon>{{ p.id === estado.persona()?.id ? 'check' : 'person' }}</mat-icon>
                <span>{{ p.nome }}</span>
              </button>
            }
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
  `,
})
export class Shell {
  protected readonly auth = inject(Auth)
  protected readonly estado = inject(Estado)
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

  protected inicial(nome?: string | null): string {
    return (nome ?? '?').trim().charAt(0).toUpperCase()
  }

  protected async sair(): Promise<void> {
    await this.auth.sair()
    await this.router.navigateByUrl('/entrar')
  }
}
