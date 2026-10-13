import { inject } from '@angular/core'
import { Router, type CanActivateFn } from '@angular/router'
import { Auth } from './auth'
import { Estado } from './estado'

// inject() so funciona antes do primeiro await: depois dele o contexto de injecao ja se perdeu.

/** So entra logado; senao vai para a tela de login. */
export const logado: CanActivateFn = async () => {
  const auth = inject(Auth)
  const router = inject(Router)
  await auth.pronto
  return auth.sessao() ? true : router.createUrlTree(['/entrar'])
}

/** Tela de login: quem ja esta logado vai direto para a pauta. */
export const deslogado: CanActivateFn = async () => {
  const auth = inject(Auth)
  const router = inject(Router)
  await auth.pronto
  return auth.sessao() ? router.createUrlTree(['/pauta']) : true
}

/** Administracao: so admin (o servidor tambem confere). */
export const soAdmin: CanActivateFn = async () => {
  const estado = inject(Estado)
  const router = inject(Router)
  if (!estado.eu()) await estado.carregarEu()
  return estado.admin() ? true : router.createUrlTree(['/pauta'])
}
