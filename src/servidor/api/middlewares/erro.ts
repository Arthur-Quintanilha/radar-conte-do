import type { NextFunction, Request, Response } from 'express'
import { ZodError } from 'zod'
import { ErroHttp } from '../erros'
import { FaltamImagens } from '../../ia/imagens'
import { logger } from '../../../comum/logger'

/** Traduz os erros em resposta. O Express 5 já manda para cá os erros das funções async. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function tratarErro(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ZodError) {
    const i = err.issues[0]
    res.status(422).json({ erro: i ? `${i.path.join('.') || 'corpo'}: ${i.message}` : 'dados invalidos', detalhes: err.issues })
    return
  }
  if (err instanceof FaltamImagens) {
    // nao e erro: o cliente extrai estas imagens da pasta local e repete o pedido com elas
    res.status(409).json({ erro: 'faltam imagens', faltamImagens: err.pedidos })
    return
  }
  if (err instanceof ErroHttp) {
    res.status(err.status).json({ erro: err.message })
    return
  }
  if (err instanceof SyntaxError && 'body' in err) {
    res.status(400).json({ erro: 'JSON invalido' })
    return
  }
  const msg = err instanceof Error ? err.message : String(err)
  // erro de regra das funcoes do dominio (ex.: "nome obrigatorio"): 400, como antes
  logger.warn({ rota: `${req.method} ${req.path}`, erro: msg }, 'pedido falhou')
  res.status(400).json({ erro: msg })
}
