import type { Quem } from '../web/usuarios'

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** quem fez o pedido (posto pelo middleware autenticar) */
      quem?: Quem
    }
  }
}

export {}
