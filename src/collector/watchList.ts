import { sql } from 'drizzle-orm'
import { db } from '../db/client'
import { author } from '../db/schema'

export type WatchStatus = 'acompanhar' | 'ignorar' | null

/**
 * Conta marcada a mao antes de aparecer em qualquer coleta. O id do Instagram so
 * chega na primeira visita; ate la fica este marcador (o parser troca pelo real).
 */
export const PENDENTE = 'pendente:'

/** username valido do Instagram: letras, numeros, ponto e sublinhado, ate 30 */
export const usernameValido = (u: string): boolean => /^[a-z0-9._]{1,30}$/.test(u)

export const normalizarUsername = (u: string): string => u.replace(/^@/, '').trim().toLowerCase()

/** Marca (ou desmarca, com null) uma conta. Devolve false se o @ nao estiver no banco. */
export async function setWatch(username: string, status: WatchStatus, quem: 'voce' | 'ia' = 'voce'): Promise<boolean> {
  const u = normalizarUsername(username)
  const rows = await db
    .update(author)
    .set({ watch: status, watchSource: status ? quem : null, watchSetAt: status ? new Date() : null })
    .where(sql`lower(${author.username}) = ${u}`)
    .returning({ id: author.id })
  return rows.length > 0
}

/**
 * Como setWatch, mas se a conta ainda nao esta no banco e voce quer acompanhar,
 * cria a conta vazia. A primeira visita (`npm run acompanhar`) preenche o resto.
 */
export async function marcarConta(username: string, status: WatchStatus): Promise<'ok' | 'criada' | 'nao_existe' | 'invalida'> {
  const u = normalizarUsername(username)
  if (!usernameValido(u)) return 'invalida'
  if (await setWatch(u, status)) return 'ok'
  if (status !== 'acompanhar') return 'nao_existe'
  await db
    .insert(author)
    .values({ igUserId: PENDENTE + u, username: u, watch: 'acompanhar', watchSource: 'voce', watchSetAt: new Date() })
    .onConflictDoNothing()
  return 'criada'
}

export async function listWatch(): Promise<{ username: string; watch: string | null; watchSource: string | null; lastWatchedAt: Date | null }[]> {
  return db
    .select({ username: author.username, watch: author.watch, watchSource: author.watchSource, lastWatchedAt: author.lastWatchedAt })
    .from(author)
    .where(sql`${author.watch} is not null`)
    .orderBy(author.watch, author.username)
}
