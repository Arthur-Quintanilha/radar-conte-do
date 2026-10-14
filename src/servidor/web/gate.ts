import type { IncomingMessage } from 'node:http'
import { config } from '../../comum/config'
import { loginLigado, usuarioDoToken } from './supabase'
import { ADMIN_LOCAL, quemE, type Quem } from './usuarios'

export type Resultado = { ok: true; quem: Quem } | { ok: false; status: 401 | 403; erro: string }

/**
 * Quem fez o pedido. Com token: confere no Supabase e procura o cadastro
 * local (sem cadastro ou desativado = 403). Sem token: so passa como admin
 * local se PAINEL_SEM_LOGIN=1 (o painel antigo, que nao tem login).
 */
export async function autenticar(req: IncomingMessage): Promise<Resultado> {
  const cab = req.headers.authorization ?? ''
  const token = /^Bearer\s+(.+)$/i.exec(cab)?.[1]?.trim()
  if (!token) {
    if (config.PAINEL_SEM_LOGIN) return { ok: true, quem: ADMIN_LOCAL }
    return { ok: false, status: 401, erro: 'faca login' }
  }
  if (!loginLigado()) return { ok: false, status: 401, erro: 'login nao configurado no servidor (SUPABASE_URL)' }
  const u = await usuarioDoToken(token)
  if (!u) return { ok: false, status: 401, erro: 'sessao expirada: entre de novo' }
  const quem = await quemE(u.id)
  if (!quem) return { ok: false, status: 403, erro: 'seu login nao tem acesso ao radar: fale com o admin' }
  return { ok: true, quem }
}
