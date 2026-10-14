import { AsyncLocalStorage } from 'node:async_hooks'
import { eq, sql } from 'drizzle-orm'
import { db, get } from '../db/client'
import { usoIa, usuario } from '../db/schema'
import { config } from '../../comum/config'
import { logger } from '../../comum/logger'

/**
 * Quanto cada login gasta de IA. Na API, o autenticar() diz quem pediu; no
 * terminal e no painel local não há login (usuarioId null) e não há teto.
 */
interface QuemGasta {
  usuarioId: string | null
}

const contexto = new AsyncLocalStorage<QuemGasta>()

export function comQuemGasta<T>(q: QuemGasta, fn: () => T): T {
  return contexto.run(q, fn)
}

const quemGasta = (): string | null => contexto.getStore()?.usuarioId ?? null

/** Estourou o teto do mês: a API responde 429. */
export class LimiteDeUso extends Error {
  constructor(
    readonly gasto: number,
    readonly limite: number,
  ) {
    super(
      limite === 0
        ? 'seu login não tem uso de IA liberado: fale com o admin'
        : `limite de IA do mês atingido (US$ ${gasto.toFixed(2)} de US$ ${limite.toFixed(2)}): fale com o admin`,
    )
  }
}

/** US$ por milhão de tokens [entrada, saída]. Estimativa: confira na tabela da Anthropic quando mudar de modelo. */
const PRECOS: [RegExp, number, number][] = [
  [/opus-4-[01]|opus-4-20|claude-3-opus/, 15, 75],
  [/opus/, 5, 25],
  [/sonnet/, 3, 15],
  [/haiku-3-5|3-5-haiku/, 0.8, 4],
  [/haiku-3|3-haiku/, 0.25, 1.25],
  [/haiku/, 1, 5],
]

export interface Tokens {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens?: number | null
  cache_creation_input_tokens?: number | null
}

export function custoEstimado(modelo: string, u: Tokens): number {
  const [, e, s] = PRECOS.find(([re]) => re.test(modelo)) ?? [null, 3, 15]
  const leitura = u.cache_read_input_tokens ?? 0
  const escrita = u.cache_creation_input_tokens ?? 0
  return (u.input_tokens * e + leitura * e * 0.1 + escrita * e * 1.25 + u.output_tokens * s) / 1_000_000
}

/** Primeiro instante do mês corrente, em segundos (como as datas do banco). */
function inicioDoMes(agora = new Date()): number {
  return Math.floor(new Date(agora.getFullYear(), agora.getMonth(), 1).getTime() / 1000)
}

export async function gastoDoMes(usuarioId: string): Promise<number> {
  const r = await get<{ total: number | null }>(
    sql`select sum(custo_usd) as total from uso_ia where usuario_id = ${usuarioId} and created_at >= ${inicioDoMes()}`,
  )
  return Number(r?.total ?? 0)
}

/** Gasto do mês de todo mundo, para a tela de admin. */
export async function gastosDoMes(): Promise<Map<string, number>> {
  const r = await db
    .select({ id: usoIa.usuarioId, total: sql<number>`sum(${usoIa.custoUsd})` })
    .from(usoIa)
    .where(sql`${usoIa.createdAt} >= ${inicioDoMes()} and ${usoIa.usuarioId} is not null`)
    .groupBy(usoIa.usuarioId)
  return new Map(r.map((x) => [x.id!, Number(x.total ?? 0)]))
}

/** Teto do mês: o do cadastro; sem ele, LIMITE_IA_MENSAL_USD; sem os dois, sem teto. */
export async function limiteDe(usuarioId: string): Promise<number | null> {
  const [u] = await db.select({ l: usuario.limiteIaUsd }).from(usuario).where(eq(usuario.id, usuarioId)).limit(1)
  return u?.l ?? config.LIMITE_IA_MENSAL_USD ?? null
}

/** Antes de chamar a IA: quem pediu ainda tem saldo no mês? */
export async function conferirLimite(): Promise<void> {
  const id = quemGasta()
  if (!id) return
  const limite = await limiteDe(id)
  if (limite === null) return
  const gasto = await gastoDoMes(id)
  if (gasto >= limite) throw new LimiteDeUso(gasto, limite)
}

/** Depois da resposta: guarda os tokens. Falhar aqui não derruba o pedido. */
export async function registrarUso(dados: { etapa: string; modelo: string; personaId?: string | null; tokens: Tokens }): Promise<void> {
  const t = dados.tokens
  try {
    await db.insert(usoIa).values({
      usuarioId: quemGasta(),
      personaId: dados.personaId ?? process.env['PERSONA_ID'] ?? null,
      etapa: dados.etapa,
      modelo: dados.modelo,
      entrada: t.input_tokens,
      saida: t.output_tokens,
      cacheLeitura: t.cache_read_input_tokens ?? 0,
      cacheEscrita: t.cache_creation_input_tokens ?? 0,
      custoUsd: custoEstimado(dados.modelo, t),
    })
  } catch (error) {
    logger.warn({ erro: error instanceof Error ? error.message : String(error) }, 'nao consegui registrar o uso da IA')
  }
}
