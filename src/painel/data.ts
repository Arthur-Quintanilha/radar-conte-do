import { sql } from 'drizzle-orm'
import { db } from '../db/client'

/** Caminho local de uma midia baixada, para o painel servir em /media/<id>. */
export async function mediaPath(id: string): Promise<string | null> {
  const rows = await db.all<{ path: string | null }>(sql`
    select local_path as path from media_asset where id = ${id} limit 1
  `)
  return rows[0]?.path ?? null
}
