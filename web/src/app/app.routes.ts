import { Routes } from '@angular/router'
import { deslogado, logado, soAdmin } from './core/guards'

export const routes: Routes = [
  { path: 'entrar', canActivate: [deslogado], loadComponent: () => import('./pages/entrar').then((m) => m.Entrar) },
  {
    path: '',
    canActivate: [logado],
    loadComponent: () => import('./layout/shell').then((m) => m.Shell),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'pauta' },
      { path: 'pauta', loadComponent: () => import('./pages/pauta').then((m) => m.Pauta) },
      { path: 'creator', loadComponent: () => import('./pages/creator').then((m) => m.Creator) },
      { path: 'sementes', loadComponent: () => import('./pages/sementes').then((m) => m.Sementes) },
      { path: 'admin', canActivate: [soAdmin], loadComponent: () => import('./pages/admin').then((m) => m.Admin) },
    ],
  },
  { path: '**', redirectTo: '' },
]
