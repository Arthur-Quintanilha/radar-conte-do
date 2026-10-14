import type { NextFunction, Request, RequestHandler, Response } from 'express'
import { comImagensDoPedido } from '../../ia/imagens'
import type { ImagensFornecidas } from '../../../comum/imagens'

/**
 * As etapas de IA veem imagens dos posts, que ficam no computador de quem
 * coletou. O cliente manda as que já tem em `imagens` no corpo; faltando, a
 * resposta 409 diz quais extrair.
 */
export const comImagens = (): RequestHandler => (req: Request, res: Response, next: NextFunction) => {
  const fornecidas = (req.body && typeof req.body === 'object' ? (req.body as { imagens?: ImagensFornecidas }).imagens : undefined) ?? {}
  void comImagensDoPedido(fornecidas, async () => {
    next()
    // espera a resposta sair para o contexto valer durante todo o handler
    await new Promise<void>((ok) => res.once('close', () => ok()))
  })
}
