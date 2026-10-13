import { Routes } from '@angular/router'
import { deslogado, logado } from './core/guards'

export const routes: Routes = [
  { path: 'entrar', canActivate: [deslogado], loadComponent: () => import('./pages/entrar').then((m) => m.Entrar) },
  {
    path: '',
    canActivate: [logado],
    loadComponent: () => import('./layout/shell').then((m) => m.Shell),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'pauta' },
      { path: 'pauta', loadComponent: () => import('./pages/pauta').then((m) => m.Pauta) },
      { path: 'creator', data: { nome: 'Creator' }, loadComponent: () => import('./pages/em-breve').then((m) => m.EmBreve) },
      { path: 'sementes', data: { nome: 'Sementes e referências' }, loadComponent: () => import('./pages/em-breve').then((m) => m.EmBreve) },
      { path: 'admin', data: { nome: 'Administração' }, loadComponent: () => import('./pages/em-breve').then((m) => m.EmBreve) },
    ],
  },
  { path: '**', redirectTo: '' },
]
