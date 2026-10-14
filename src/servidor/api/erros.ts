/** Erros que viram resposta HTTP (o middleware de erro traduz). */

export class ErroHttp extends Error {
  constructor(
    readonly status: number,
    mensagem: string,
  ) {
    super(mensagem)
    this.name = 'ErroHttp'
  }
}

export const proibido = (msg = 'voce nao tem acesso a esse creator'): ErroHttp => new ErroHttp(403, msg)
export const naoEncontrado = (msg = 'nao encontrado'): ErroHttp => new ErroHttp(404, msg)
export const conflito = (msg: string): ErroHttp => new ErroHttp(409, msg)
export const invalido = (msg: string): ErroHttp => new ErroHttp(400, msg)
