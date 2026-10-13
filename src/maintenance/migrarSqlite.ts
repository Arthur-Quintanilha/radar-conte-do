import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { getTableColumns, getTableName, sql, type Table } from 'drizzle-orm'
import { all, db, run } from '../db/client'
import * as s from '../db/schema'
import { config } from '../shared/config'

/**
 * Copia o banco SQLite antigo (data/ig-insights.db) para o Postgres da
 * DATABASE_URL. Le o SQLite pelo node:sqlite (sem dependencia nativa) e grava
 * pelo drizzle, convertendo o que muda de um banco para o outro: 0/1 vira
 * booleano, texto JSON vira jsonb, segundos viram Date (e voltam a segundos).
 *
 * Os corpos das respostas brutas (raw_response.body, ~350 MB) nao vao por
 * padrao: ficam um marcador, e os arquivos em data/raw continuam sendo a copia
 * completa. --com-brutos copia tudo.
 */

/** Ordem de dependencia: quem e referenciado vem antes. */
const TABELAS: Table[] = [
  s.collectionRun,
  s.rawResponse,
  s.author,
  s.post,
  s.discovery,
  s.postMetric,
  s.hashtag,
  s.postHashtag,
  s.comment,
  s.mediaAsset,
  s.enrichment,
  s.postEmbedding,
  s.classification,
  s.idea,
  s.persona,
  s.semente,
  s.seguindo,
  s.personaConta,
  s.encaixe,
  s.ideia,
  s.referencia,
  s.roteiro,
  s.pautaVisto,
]

export interface MigrarOpcoes {
  arquivo?: string
  comBrutos?: boolean
  /** apaga o que ja existe no Postgres antes de copiar */
  limpar?: boolean
}

export interface MigrarResumo {
  tabela: string
  sqlite: number
  postgres: number
}

type Coluna = { name: string; columnType: string; notNull: boolean }

function converter(valor: unknown, c: Coluna): unknown {
  if (valor === null || valor === undefined) return null
  switch (c.columnType) {
    case 'PgBoolean':
      return valor === 1 || valor === 1n || valor === true || valor === '1' || valor === 'true'
    case 'PgJsonb':
      if (typeof valor !== 'string') return valor
      try {
        return JSON.parse(valor) as unknown
      } catch {
        return valor
      }
    case 'PgCustomColumn': {
      // datas: segundos no SQLite; alguns registros antigos podem estar em milissegundos
      const n = Number(valor)
      if (!Number.isFinite(n)) return null
      return new Date((n > 1e12 ? Math.floor(n / 1000) : n) * 1000)
    }
    case 'PgInteger':
    case 'PgBigInt53':
    case 'PgDoublePrecision': {
      const n = Number(valor)
      return Number.isFinite(n) ? n : null
    }
    default:
      return typeof valor === 'string' ? valor : String(valor)
  }
}

export async function migrarSqlite(opts: MigrarOpcoes = {}): Promise<MigrarResumo[]> {
  const arquivo = resolve(process.cwd(), opts.arquivo ?? config.DB_FILE)
  if (!existsSync(arquivo)) throw new Error(`não achei o banco SQLite em ${arquivo}`)
  const origem = new DatabaseSync(arquivo, { readOnly: true })
  const existentes = new Set(
    (origem.prepare(`select name from sqlite_master where type = 'table'`).all() as { name: string }[]).map((r) => r.name),
  )
  const resumo: MigrarResumo[] = []
  try {
    if (opts.limpar) {
      const nomes = TABELAS.map((t) => `"${getTableName(t)}"`).join(', ')
      await run(sql.raw(`truncate ${nomes} cascade`))
      console.log('  tabelas do Postgres esvaziadas')
    }
    for (const tabela of TABELAS) {
      const nome = getTableName(tabela)
      if (!existentes.has(nome)) {
        console.log(`  ${nome}: não existe no SQLite, pulando`)
        continue
      }
      const colunas = Object.entries(getTableColumns(tabela)) as [string, Coluna][]
      const total = (origem.prepare(`select count(*) as n from "${nome}"`).get() as { n: number }).n
      // lote pelo limite de parametros do Postgres (65535)
      const lote = Math.max(1, Math.floor(20_000 / colunas.length))
      const brutoOmitido = nome === 'raw_response' && !opts.comBrutos
      let copiadas = 0
      for (let ini = 0; ini < total; ini += lote) {
        const linhas = origem.prepare(`select * from "${nome}" limit ? offset ?`).all(lote, ini) as Record<string, unknown>[]
        const valores = linhas.map((l) => {
          const o: Record<string, unknown> = {}
          for (const [chave, c] of colunas) {
            let v = converter(l[c.name], c)
            if (brutoOmitido && c.name === 'body') v = { omitido: true, motivo: 'copia sem os corpos brutos; ver data/raw' }
            if (v === null && c.notNull) continue // deixa o default do schema preencher
            o[chave] = v
          }
          return o
        })
        if (valores.length) {
          await db.insert(tabela).values(valores as never).onConflictDoNothing()
        }
        copiadas += linhas.length
        if (total > lote) process.stdout.write(`\r  ${nome}: ${copiadas}/${total}`)
      }
      const [r] = await all<{ n: number }>(sql.raw(`select count(*)::int as n from "${nome}"`))
      if (total > lote) process.stdout.write('\n')
      console.log(`  ${nome}: ${total} no SQLite, ${r?.n ?? 0} no Postgres${brutoOmitido ? ' (sem os corpos brutos)' : ''}`)
      resumo.push({ tabela: nome, sqlite: total, postgres: r?.n ?? 0 })
    }
  } finally {
    origem.close()
  }
  return resumo
}
