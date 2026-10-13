import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import type { SQL } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite'
import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { config } from '../shared/config'
import * as schema from './schema'

/**
 * Postgres. DATABASE_URL decide onde:
 *  - postgres://... : o Supabase (ou qualquer Postgres)
 *  - pglite:<pasta> : um Postgres embutido em arquivo, sem servidor (pglite:memory = so na memoria)
 * Nenhum dos dois conecta ao importar: a conexao abre na primeira consulta.
 */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>

let fechar: (() => Promise<void>) | null = null

function abrirPglite(alvo: string): Db {
  const memoria = alvo === '' || alvo === 'memory'
  const pasta = memoria ? undefined : resolve(process.cwd(), alvo)
  if (pasta) mkdirSync(pasta, { recursive: true })
  const client = new PGlite(pasta, {
    // bigint (datas, count) e numeric viram number, como no driver do Postgres abaixo
    parsers: { 20: (v: string) => Number(v), 1700: (v: string) => Number(v) },
  })
  fechar = () => client.close()
  return drizzlePglite(client, { schema }) as unknown as Db
}

function abrirPostgres(url: string): Db {
  const numero = { serialize: (x: unknown) => String(x), parse: (x: string) => Number(x) }
  const client = postgres(url, {
    max: 5,
    onnotice: () => undefined,
    // count(*), sum() e colunas bigint (datas) chegam como number, nao string
    types: { int8: { to: 20, from: [20], ...numero }, numeric: { to: 1700, from: [1700], ...numero } },
  })
  fechar = () => client.end({ timeout: 5 })
  return drizzlePostgres(client, { schema }) as unknown as Db
}

function abrir(): Db {
  const url = config.DATABASE_URL?.trim()
  if (!url) {
    // sem banco configurado: so falha quando alguem tentar usar
    return new Proxy({} as Db, {
      get() {
        throw new Error('DATABASE_URL não configurada no .env (postgres://... do Supabase, ou pglite:./data/pg para um banco local)')
      },
    })
  }
  return url.startsWith('pglite:') ? abrirPglite(url.slice('pglite:'.length)) : abrirPostgres(url)
}

export const db: Db = abrir()

type Linhas<T> = { rows: T[] } | T[]

/** SQL cru: todas as linhas. */
export async function all<T>(q: SQL): Promise<T[]> {
  const r = (await db.execute(q)) as unknown as Linhas<T>
  return Array.isArray(r) ? [...r] : r.rows
}

/** SQL cru: a primeira linha. */
export async function get<T>(q: SQL): Promise<T | undefined> {
  return (await all<T>(q))[0]
}

/** SQL cru sem retorno. */
export async function run(q: SQL): Promise<void> {
  await db.execute(q)
}

export async function closeDb(): Promise<void> {
  const f = fechar
  fechar = null
  if (f) await f()
}

/** Coluna jsonb lida por SQL cru: o driver ja devolve o objeto; texto antigo ainda e aceito. */
export function comoJson<T>(v: unknown, padrao: T): T {
  if (v === null || v === undefined || v === '') return padrao
  if (typeof v === 'string') {
    try {
      return JSON.parse(v) as T
    } catch {
      return padrao
    }
  }
  return v as T
}
