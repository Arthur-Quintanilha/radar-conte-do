export interface FollowedUser {
  igUserId: string | null
  username: string
  fullName: string | null
  isVerified: boolean | null
  isPrivate: boolean | null
}

/**
 * Dona da lista aberta. O Instagram abre o modal de "seguindo" sem mudar o
 * endereco: a resposta da API REST (friendships/<id>/following) chega com o
 * perfil da semente na barra (instagram.com/<semente>/). Versoes antigas
 * mudavam para /<semente>/following/, e as duas formas valem.
 * Para o graphql, que serve mil outras coisas, so vale /<semente>/following/.
 */
export function sementeDaPagina(pageUrl: string | null, kind?: string): string | null {
  if (!pageUrl) return null
  try {
    const partes = new URL(pageUrl).pathname.split('/').filter(Boolean)
    const u = (partes[0] ?? '').toLowerCase()
    if (!/^[a-z0-9._]{1,30}$/.test(u) || RESERVADOS.has(u)) return null
    if (partes[1] === 'following') return u
    if (kind === 'following' && partes.length === 1) return u
    return null
  } catch {
    return null
  }
}

const RESERVADOS = new Set(['explore', 'p', 'reel', 'reels', 'stories', 'accounts', 'direct', 'tv', 'about', 'legal', 'developer', 'web', 'api'])

const obj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)

function paraUsuario(v: unknown): FollowedUser | null {
  const n = obj(v) && obj(v['node']) ? (v['node'] as Record<string, unknown>) : v
  if (!obj(n)) return null
  const username = n['username']
  if (typeof username !== 'string' || !/^[\w.]{1,30}$/.test(username)) return null
  const idBruto = n['pk'] ?? n['pk_id'] ?? n['id'] ?? n['strong_id__']
  const bool = (x: unknown): boolean | null => (typeof x === 'boolean' ? x : null)
  return {
    igUserId: typeof idBruto === 'string' || typeof idBruto === 'number' ? String(idBruto) : null,
    username: username.toLowerCase(),
    fullName: typeof n['full_name'] === 'string' ? n['full_name'] : null,
    isVerified: bool(n['is_verified']),
    isPrivate: bool(n['is_private']),
  }
}

// listas que parecem "seguindo" mas nao sao: seguidos em comum, sugestoes
const NAO_E = /mutual|suggest|chaining|recommend|similar/i

/**
 * Usuarios de uma resposta da lista de "seguindo". A API REST
 * (friendships/<id>/following) traz `users` na raiz; no graphql so vale o que
 * esta debaixo de uma chave com "follow" no nome (edge_follow, *following*).
 */
export function extractFollowing(body: unknown, rest = false): FollowedUser[] {
  const achados = new Map<string, FollowedUser>()

  const colher = (lista: unknown[]): void => {
    for (const item of lista) {
      const u = paraUsuario(item)
      if (u && !achados.has(u.username)) achados.set(u.username, u)
    }
  }

  const andar = (v: unknown, dentroDeFollow: boolean, prof: number): void => {
    if (prof > 12) return
    if (Array.isArray(v)) {
      for (const x of v) andar(x, dentroDeFollow, prof + 1)
      return
    }
    if (!obj(v)) return
    for (const [k, filho] of Object.entries(v)) {
      if (NAO_E.test(k)) continue
      const follow = dentroDeFollow || /follow/i.test(k)
      if (Array.isArray(filho) && (k === 'users' || k === 'edges') && follow) colher(filho)
      else andar(filho, follow, prof + 1)
    }
  }

  if (rest && obj(body) && Array.isArray(body['users'])) colher(body['users'])
  else andar(body, false, 0)
  return [...achados.values()]
}
