import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { author, referencia } from '../db/schema'
import { PENDENTE } from '../collector/watchList'
import { normalizarUsername, usernameValido } from './persona'

export type Referencia = typeof referencia.$inferSelect
export type StatusReferencia = 'ativa' | 'sugerida' | 'pausada'

export async function listarReferencias(personaId: string): Promise<Referencia[]> {
  return db.select().from(referencia).where(eq(referencia.personaId, personaId)).orderBy(asc(referencia.status), asc(referencia.username))
}

export function referenciasAtivas(personaId: string): string[] {
  return db
    .all<{ u: string }>(sql`select username as u from referencia where persona_id = ${personaId} and status = 'ativa'`)
    .map((r) => r.u)
}

/**
 * Referencia ativa = conta que o `acompanhar` visita (watch_source = referencia).
 * Pausada ou removida sai da fila, a nao ser que outra persona ainda a use
 * ou que voce a tenha marcado a mao.
 */
export async function sincronizarReferencias(): Promise<{ marcadas: number; liberadas: number }> {
  const ativas = new Set(
    db.all<{ u: string }>(sql`select distinct r.username as u from referencia r join persona p on p.id = r.persona_id where r.status = 'ativa'`).map((r) => r.u),
  )
  let marcadas = 0
  for (const u of ativas) {
    const [a] = await db.select({ id: author.id, watch: author.watch, watchSource: author.watchSource }).from(author).where(sql`lower(${author.username}) = ${u}`).limit(1)
    if (!a) {
      await db.insert(author).values({ igUserId: PENDENTE + u, username: u, watch: 'acompanhar', watchSource: 'referencia', watchSetAt: new Date() }).onConflictDoNothing()
      marcadas++
    } else if (a.watch !== 'acompanhar' && a.watchSource !== 'voce') {
      await db.update(author).set({ watch: 'acompanhar', watchSource: 'referencia', watchSetAt: new Date() }).where(eq(author.id, a.id))
      marcadas++
    }
  }
  const antigas = await db.select({ id: author.id, username: author.username }).from(author).where(and(eq(author.watchSource, 'referencia'), eq(author.watch, 'acompanhar')))
  const soltar = antigas.filter((a) => !ativas.has(a.username.toLowerCase())).map((a) => a.id)
  if (soltar.length) await db.update(author).set({ watch: null, watchSource: null, watchSetAt: null }).where(inArray(author.id, soltar))
  return { marcadas, liberadas: soltar.length }
}

export interface AddReferencias {
  adicionadas: string[]
  jaExistiam: string[]
  invalidas: string[]
}

export async function adicionarReferencias(
  personaId: string,
  texto: string | string[],
  opts: { status?: StatusReferencia; origem?: 'voce' | 'sugestao'; motivo?: string | null } = {},
): Promise<AddReferencias> {
  const brutos = Array.isArray(texto) ? texto : texto.split(/[\s,;]+/)
  const r: AddReferencias = { adicionadas: [], jaExistiam: [], invalidas: [] }
  for (const b of brutos) {
    if (!b.trim()) continue
    const u = normalizarUsername(b)
    if (!usernameValido(u)) {
      r.invalidas.push(b.trim())
      continue
    }
    const [existente] = await db.select().from(referencia).where(and(eq(referencia.personaId, personaId), eq(referencia.username, u))).limit(1)
    if (existente) {
      // voce cadastrando de novo uma sugerida ou pausada: vira ativa
      if ((opts.origem ?? 'voce') === 'voce' && existente.status !== 'ativa') {
        await db.update(referencia).set({ status: 'ativa' }).where(eq(referencia.id, existente.id))
        r.adicionadas.push(u)
      } else r.jaExistiam.push(u)
      continue
    }
    await db.insert(referencia).values({ personaId, username: u, status: opts.status ?? 'ativa', origem: opts.origem ?? 'voce', motivo: opts.motivo ?? null })
    r.adicionadas.push(u)
  }
  await sincronizarReferencias()
  return r
}

export async function setStatusReferencia(personaId: string, username: string, status: 'ativa' | 'pausada' | 'remover'): Promise<boolean> {
  const where = and(eq(referencia.personaId, personaId), eq(referencia.username, normalizarUsername(username)))
  const rows =
    status === 'remover'
      ? await db.delete(referencia).where(where).returning({ id: referencia.id })
      : await db.update(referencia).set({ status }).where(where).returning({ id: referencia.id })
  await sincronizarReferencias()
  return rows.length > 0
}
