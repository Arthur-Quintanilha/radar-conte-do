import type { IncomingMessage, ServerResponse } from 'node:http'
import { listarPersonas } from '../creator/persona'
import { atualizarUsuario, criarUsuario, definirAcesso, listarUsuarios, personasDe, type Papel, type Quem } from '../web/usuarios'
import { json, lerJson } from './http'

const s = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
const papel = (v: unknown): Papel | undefined => (v === 'admin' || v === 'membro' ? v : undefined)
const lista = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

/** /api/eu (qualquer logado) e /api/admin/* (so admin). Devolve false quando a rota nao e dela. */
export async function handleAdmin(req: IncomingMessage, res: ServerResponse, url: URL, quem: Quem): Promise<boolean> {
  const rota = url.pathname

  if (rota === '/api/eu' && req.method === 'GET') {
    json(res, 200, { id: quem.id, email: quem.email, papel: quem.papel, local: Boolean(quem.local), personas: await personasDe(quem) })
    return true
  }

  if (!rota.startsWith('/api/admin')) return false
  if (quem.papel !== 'admin') {
    json(res, 403, { erro: 'so admin' })
    return true
  }

  try {
    if (rota === '/api/admin/usuarios' && req.method === 'GET') {
      const personas = (await listarPersonas()).map((p) => ({ id: p.id, nome: p.nome, handle: p.handle }))
      json(res, 200, { usuarios: await listarUsuarios(), personas })
      return true
    }
    if (rota === '/api/admin/usuarios' && req.method === 'POST') {
      const b = await lerJson(req, 10_000)
      const u = await criarUsuario({ email: s(b['email']) ?? '', senha: s(b['senha']), nome: s(b['nome']), papel: papel(b['papel']), personas: lista(b['personas']) })
      json(res, 200, { ok: true, usuario: u })
      return true
    }
    const m = rota.match(/^\/api\/admin\/usuarios\/([\w-]+)$/)
    if (m?.[1] && req.method === 'POST') {
      const b = await lerJson(req, 10_000)
      await atualizarUsuario(
        m[1],
        {
          nome: b['nome'] === null ? null : s(b['nome']),
          papel: papel(b['papel']),
          ativo: typeof b['ativo'] === 'boolean' ? b['ativo'] : undefined,
          senha: s(b['senha']),
        },
        quem,
      )
      if (Array.isArray(b['personas'])) await definirAcesso(m[1], lista(b['personas']))
      json(res, 200, { ok: true })
      return true
    }
    json(res, 404, { erro: 'rota nao encontrada' })
  } catch (error) {
    json(res, 400, { erro: error instanceof Error ? error.message : String(error) })
  }
  return true
}
