import { sql } from 'drizzle-orm'
import { db } from '../db/client'
import { semente, seguindo } from '../db/schema'
import type { FollowedUser } from '../../comum/parser/following'

/** Grava as arestas. Reprocessar a mesma resposta so renova o `vistoEm`. */
export async function gravarSeguindo(semente_: string, users: FollowedUser[], runId: string | null, vistoEm: Date): Promise<number> {
  let n = 0
  for (const u of users) {
    if (u.username === semente_) continue
    await db
      .insert(seguindo)
      .values({ semente: semente_, igUserId: u.igUserId, username: u.username, fullName: u.fullName, isVerified: u.isVerified, isPrivate: u.isPrivate, runId, vistoEm })
      .onConflictDoUpdate({
        target: [seguindo.semente, seguindo.username],
        set: { vistoEm: sql`greatest(${seguindo.vistoEm}, ${Math.floor(vistoEm.getTime() / 1000)})`, fullName: u.fullName, runId },
      })
    n++
  }
  // a lista chegou: a semente esta coletada, mesmo que a sessao tenha contado errado
  if (n > 0) {
    await db
      .update(semente)
      .set({ coletadaEm: sql`coalesce(${semente.coletadaEm}, ${Math.floor(vistoEm.getTime() / 1000)})`, erro: null, privada: false })
      .where(sql`lower(${semente.username}) = ${semente_}`)
  }
  return n
}
