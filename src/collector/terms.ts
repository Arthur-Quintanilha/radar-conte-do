import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { and, eq, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { collectionRun } from '../db/schema'
import { config } from '../shared/config'

export function normalizeTerm(termo: string): string {
  return termo.trim().replace(/\s+/g, ' ').toLowerCase()
}

/** Le termos.txt: um termo por linha, # comenta. */
export function parseTermsFile(text: string): string[] {
  const out: string[] = []
  const vistos = new Set<string>()
  for (const linha of text.split(/\r?\n/)) {
    const termo = normalizeTerm(linha.replace(/#.*$/, ''))
    if (termo && !vistos.has(termo)) {
      vistos.add(termo)
      out.push(termo)
    }
  }
  return out
}

export function loadTerms(file = config.SEARCH_TERMS_FILE): string[] {
  const path = resolve(process.cwd(), file)
  if (!existsSync(path)) return []
  return parseTermsFile(readFileSync(path, 'utf8'))
}

export interface TermStatus {
  termo: string
  buscas: number
  ultima: Date | null
}

/** Quantas vezes cada termo ja foi pesquisado com sucesso, e quando. */
export async function termStatus(terms: string[]): Promise<TermStatus[]> {
  const rows = await db
    .select({
      term: collectionRun.term,
      n: sql<number>`count(*)`,
      last: sql<number | null>`max(${collectionRun.startedAt})`,
    })
    .from(collectionRun)
    .where(and(eq(collectionRun.kind, 'search'), eq(collectionRun.status, 'ok')))
    .groupBy(collectionRun.term)

  const porTermo = new Map(rows.map((r) => [r.term ?? '', r]))
  return terms.map((termo) => {
    const r = porTermo.get(termo)
    return { termo, buscas: r?.n ?? 0, ultima: r?.last ? new Date(r.last * 1000) : null }
  })
}

/** O proximo da fila: nunca pesquisado primeiro, depois o mais antigo. */
export function pickNext(status: TermStatus[]): string | null {
  const ordenado = [...status].sort((a, b) => {
    const ta = a.ultima?.getTime() ?? -1
    const tb = b.ultima?.getTime() ?? -1
    return ta - tb
  })
  return ordenado[0]?.termo ?? null
}
