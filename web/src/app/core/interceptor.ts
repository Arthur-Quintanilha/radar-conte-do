import { inject } from '@angular/core'
import { Router } from '@angular/router'
import type { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http'
import { catchError, throwError } from 'rxjs'
import { Auth } from './auth'

/**
 * Toda chamada a nossa API leva o token do login. POST leva tambem o cabecalho
 * x-painel, que o servidor exige (protege contra formulario de outro site).
 * Se o servidor responder 401 (sessao expirada), sai e volta para o login.
 */
export const comToken: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith('/api/')) return next(req)
  const auth = inject(Auth)
  const router = inject(Router)
  const token = auth.token()
  let headers = req.headers
  if (token) headers = headers.set('Authorization', `Bearer ${token}`)
  if (req.method !== 'GET') headers = headers.set('x-painel', '1')
  return next(req.clone({ headers })).pipe(
    catchError((e: HttpErrorResponse) => {
      if (e.status === 401) void auth.sair().then(() => router.navigateByUrl('/entrar'))
      return throwError(() => e)
    }),
  )
}
