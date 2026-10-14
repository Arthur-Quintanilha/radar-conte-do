import type { Request } from 'express'
import { exigirPersona, type Persona } from '../creator/persona'
import { personaAtualDe, personaDaIdeia, personaDoRoteiro, personasDe, podeVer, type Quem } from '../web/usuarios'
import { naoEncontrado, proibido } from './erros'
import { quem } from './middlewares/autenticar'

/** Para quem não é admin: só os creators liberados. */
export async function exigirAcesso(q: Quem, personaId: string | null | undefined): Promise<void> {
  if (q.papel === 'admin') return
  if (!(await podeVer(q, personaId))) throw proibido()
}

/** O creator do caminho (:creatorId). "atual" = o que essa pessoa está vendo. */
export async function creatorDoPedido(req: Request): Promise<Persona> {
  const q = quem(req)
  const param = String(req.params['creatorId'] ?? 'atual')
  const id = param === 'atual' ? await personaAtualDe(q) : param
  if (!id) throw naoEncontrado('nenhum creator escolhido')
  await exigirAcesso(q, id)
  return exigirPersona(id)
}

/** A ideia do caminho (:ideiaId), conferindo o acesso ao creator dela. */
export async function ideiaDoPedido(req: Request): Promise<string> {
  const id = String(req.params['ideiaId'] ?? '')
  const p = await personaDaIdeia(id)
  if (!p) throw naoEncontrado('ideia nao encontrada')
  await exigirAcesso(quem(req), p)
  return id
}

export async function roteiroDoPedido(req: Request): Promise<string> {
  const id = String(req.params['roteiroId'] ?? '')
  const p = await personaDoRoteiro(id)
  if (!p) throw naoEncontrado('roteiro nao encontrado')
  await exigirAcesso(quem(req), p)
  return id
}

export { personasDe, personaAtualDe }
