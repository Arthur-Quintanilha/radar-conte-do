import { config } from '../../comum/config'

/**
 * Conversa com o Supabase Auth pela API REST (sem SDK). Duas coisas:
 *  - conferir o token do login (quem e esse usuario);
 *  - criar, achar e bloquear usuarios, com a chave secret (so admin).
 */

export interface UsuarioSupabase {
  id: string
  email: string
}

export function loginLigado(): boolean {
  return Boolean(config.SUPABASE_URL)
}

function base(): string {
  if (!config.SUPABASE_URL) throw new Error('SUPABASE_URL vazia no .env')
  return config.SUPABASE_URL.replace(/\/+$/, '')
}

function chaveSecreta(): string {
  const k = config.SUPABASE_SECRET_KEY
  if (!k || k.startsWith('COLE_AQUI')) throw new Error('SUPABASE_SECRET_KEY vazia no .env (Supabase > Project Settings > API > secret)')
  return k
}

/** Cabecalhos de admin. A chave nova (sb_secret_) vai so no apikey; a antiga (JWT) vai nos dois. */
function cabecalhosAdmin(): Record<string, string> {
  const k = chaveSecreta()
  return k.startsWith('sb_') ? { apikey: k } : { apikey: k, authorization: `Bearer ${k}` }
}

async function pedir<T>(caminho: string, init: RequestInit): Promise<T> {
  const r = await fetch(`${base()}${caminho}`, { ...init, signal: AbortSignal.timeout(10_000) })
  const corpo = (await r.json().catch(() => ({}))) as Record<string, unknown>
  if (!r.ok) {
    const msg = String(corpo['msg'] ?? corpo['message'] ?? corpo['error_description'] ?? corpo['error'] ?? `HTTP ${r.status}`)
    throw Object.assign(new Error(`Supabase: ${msg}`), { status: r.status })
  }
  return corpo as T
}

// token -> usuario por um minuto: cada tela faz varios pedidos e nao precisa perguntar ao Supabase em todos
const cache = new Map<string, { u: UsuarioSupabase; ate: number }>()
const CACHE_MS = 60_000

/** Quem e o dono deste token, ou null se o token nao vale (expirou, foi revogado, e de outro projeto). */
export async function usuarioDoToken(token: string): Promise<UsuarioSupabase | null> {
  const agora = Date.now()
  const c = cache.get(token)
  if (c && c.ate > agora) return c.u
  try {
    const u = await pedir<{ id: string; email?: string }>('/auth/v1/user', {
      headers: { apikey: chaveSecreta(), authorization: `Bearer ${token}` },
    })
    const usuario = { id: u.id, email: (u.email ?? '').toLowerCase() }
    if (cache.size > 500) cache.clear()
    cache.set(token, { u: usuario, ate: agora + CACHE_MS })
    return usuario
  } catch (e) {
    if ((e as { status?: number }).status === 401 || (e as { status?: number }).status === 403) return null
    throw e
  }
}

export function esquecerTokens(): void {
  cache.clear()
}

/** Cria o login ja confirmado, com a senha que o admin escolheu. */
export async function criarLogin(email: string, senha: string): Promise<UsuarioSupabase> {
  const u = await pedir<{ id: string; email: string }>('/auth/v1/admin/users', {
    method: 'POST',
    headers: { ...cabecalhosAdmin(), 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: senha, email_confirm: true }),
  })
  return { id: u.id, email: u.email.toLowerCase() }
}

export async function acharLogin(email: string): Promise<UsuarioSupabase | null> {
  const alvo = email.trim().toLowerCase()
  for (let pagina = 1; pagina <= 20; pagina++) {
    const r = await pedir<{ users: { id: string; email?: string }[] }>(`/auth/v1/admin/users?page=${pagina}&per_page=200`, {
      headers: cabecalhosAdmin(),
    })
    const u = r.users.find((x) => (x.email ?? '').toLowerCase() === alvo)
    if (u) return { id: u.id, email: alvo }
    if (r.users.length < 200) break
  }
  return null
}

/** Bloqueia (ou libera) o login no Supabase: o token atual para de valer na proxima renovacao. */
export async function bloquearLogin(id: string, bloquear: boolean): Promise<void> {
  await pedir(`/auth/v1/admin/users/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { ...cabecalhosAdmin(), 'content-type': 'application/json' },
    body: JSON.stringify({ ban_duration: bloquear ? '876000h' : 'none' }),
  })
  esquecerTokens()
}

export async function trocarSenha(id: string, senha: string): Promise<void> {
  await pedir(`/auth/v1/admin/users/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { ...cabecalhosAdmin(), 'content-type': 'application/json' },
    body: JSON.stringify({ password: senha }),
  })
}
