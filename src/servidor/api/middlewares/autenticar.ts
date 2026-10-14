import type { NextFunction, Request, RequestHandler, Response } from 'express'
import type { Quem } from '../../web/usuarios'
import { autenticar as conferirToken } from '../../web/gate'
import '../tipos'

/** Confere o token do Supabase e põe quem pediu em req.quem. */
export const autenticar = (): RequestHandler => async (req: Request, res: Response, next: NextFunction) => {
  const r = await conferirToken(req)
  if (!r.ok) {
    res.status(r.status).json({ erro: r.erro })
    return
  }
  req.quem = r.quem
  next()
}

/** Só admin passa. */
export const soAdmin = (): RequestHandler => (req: Request, res: Response, next: NextFunction) => {
  if (req.quem?.papel !== 'admin') {
    res.status(403).json({ erro: 'so admin' })
    return
  }
  next()
}

/**
 * Todo pedido que muda algo leva o cabeçalho x-painel. Um site qualquer não
 * consegue mandar esse cabeçalho sem a permissão de CORS, então um formulário
 * de outro site não aciona o painel local (que roda sem login).
 */
export const exigirCabecalhoPainel = (): RequestHandler => (req: Request, res: Response, next: NextFunction) => {
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS' && req.headers['x-painel'] !== '1') {
    res.status(403).json({ erro: 'proibido' })
    return
  }
  next()
}

/** Quem pediu (a rota passou pelo autenticar). */
export function quem(req: Request): Quem {
  if (!req.quem) throw new Error('rota sem autenticar()')
  return req.quem
}
