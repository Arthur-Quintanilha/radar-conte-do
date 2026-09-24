import { createHash } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { collectionRun } from '../db/schema'
import { config } from './config'
import { localDayKey, localHour } from './time'

export type RunKind = 'explore' | 'search' | 'authors'

export interface BudgetDecision {
  allowed: boolean
  reason: string
  sessionsToday: number
}

/** Semana ISO e o indice do dia dentro dela (0 = segunda). */
function isoWeekOf(dayKey: string): { week: string; dayIndex: number } {
  const [year, month, day] = dayKey.split('-').map(Number)
  const date = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1))
  const dayIndex = (date.getUTCDay() + 6) % 7

  // a quinta-feira da semana define o ano/semana ISO
  const thursday = new Date(date)
  thursday.setUTCDate(date.getUTCDate() - dayIndex + 3)

  const firstThursday = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4))
  firstThursday.setUTCDate(firstThursday.getUTCDate() - ((firstThursday.getUTCDay() + 6) % 7) + 3)

  const week = 1 + Math.round((thursday.getTime() - firstThursday.getTime()) / (7 * 86_400_000))
  return { week: `${thursday.getUTCFullYear()}-W${week}`, dayIndex }
}

/** Escolhe N dias distintos da semana, sempre os mesmos para a mesma semana. */
function restDaysOfWeek(week: string, count: number): Set<number> {
  const ranked = [0, 1, 2, 3, 4, 5, 6]
    .map((day) => ({ day, key: createHash('sha256').update(`${week}:${day}`).digest('hex') }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))

  return new Set(ranked.slice(0, count).map((r) => r.day))
}

/**
 * Folga deterministica, sorteada POR SEMANA e nao por dia.
 *
 * Desligado por padrao (REST_DAYS_PER_WEEK=0). Para religar, basta definir
 * quantos dias por semana no .env.
 *
 * Sortear cada dia de forma independente parece equivalente, mas nao e:
 * com 2/7 de chance por dia aparecem sequencias de 5 ou 6 dias parados,
 * e a coleta morre por uma semana sem ninguem perceber. Escolhendo N dias
 * dentro de cada semana, sao sempre exatamente N — nunca mais que isso.
 */
export function isRestDay(
  dayKey: string = localDayKey(),
  count: number = config.REST_DAYS_PER_WEEK,
): boolean {
  if (count <= 0) return false
  if (count >= 7) return true

  const { week, dayIndex } = isoWeekOf(dayKey)
  return restDaysOfWeek(week, count).has(dayIndex)
}

export async function sessionsToday(
  kind: RunKind = 'explore',
  dayKey: string = localDayKey(),
): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)` })
    .from(collectionRun)
    .where(and(eq(collectionRun.kind, kind), eq(collectionRun.dayKey, dayKey)))
  return rows[0]?.n ?? 0
}

function maxSessionsFor(kind: RunKind): number {
  if (kind === 'authors') return config.MAX_AUTHOR_SESSIONS_PER_DAY
  if (kind === 'search') return config.MAX_SEARCH_SESSIONS_PER_DAY
  return config.MAX_SESSIONS_PER_DAY
}

/** Regras duras: janela horaria, teto diario, dia de folga. */
export async function checkBudget(
  kind: RunKind = 'explore',
  now: Date = new Date(),
): Promise<BudgetDecision> {
  const dayKey = localDayKey(now)
  const hour = localHour(now)
  const done = await sessionsToday(kind, dayKey)
  const max = maxSessionsFor(kind)

  if (hour < config.COLLECT_WINDOW_START || hour >= config.COLLECT_WINDOW_END) {
    return {
      allowed: false,
      reason: `fora da janela (${config.COLLECT_WINDOW_START}h-${config.COLLECT_WINDOW_END}h, agora ${hour}h)`,
      sessionsToday: done,
    }
  }
  if (isRestDay(dayKey)) {
    return { allowed: false, reason: `${dayKey} e dia de folga`, sessionsToday: done }
  }
  if (done >= max) {
    return {
      allowed: false,
      reason: `teto diario de ${kind} atingido (${done}/${max})`,
      sessionsToday: done,
    }
  }
  return { allowed: true, reason: 'dentro do orcamento', sessionsToday: done }
}

/**
 * Decisao probabilistica para o cron horario. Distribui as sessoes restantes
 * pelas horas restantes da janela, em vez de rodar sempre no mesmo horario.
 */
export async function shouldRunThisHour(now: Date = new Date()): Promise<BudgetDecision> {
  const base = await checkBudget('explore', now)
  if (!base.allowed) return base

  const hour = localHour(now)
  const hoursLeft = Math.max(1, config.COLLECT_WINDOW_END - hour)
  const sessionsLeft = Math.max(0, config.MAX_SESSIONS_PER_DAY - base.sessionsToday)
  const p = Math.min(1, sessionsLeft / hoursLeft)

  if (Math.random() > p) {
    return {
      allowed: false,
      reason: `sorteio da hora nao caiu (p=${p.toFixed(2)})`,
      sessionsToday: base.sessionsToday,
    }
  }
  return { ...base, reason: `sorteio da hora caiu (p=${p.toFixed(2)})` }
}
