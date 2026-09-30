import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { logger } from '../shared/logger'
import { notify } from '../shared/notify'

export type Signal = 'rate_limited' | 'challenge' | 'logged_out' | 'empty_feed' | 'nav_error'

const WEIGHTS: Record<Signal, number> = {
  challenge: 100,
  logged_out: 6,
  rate_limited: 3,
  empty_feed: 2,
  nav_error: 1,
}

const THRESHOLD = 5
const BACKOFF_HOURS = [1, 6, 24, 48] as const

interface BreakerState {
  points: number
  level: number
  openUntil: string | null
  lastSignal: string | null
  updatedAt: string
}

const STATE_PATH = resolve(process.cwd(), 'data', 'breaker.json')

const EMPTY: BreakerState = {
  points: 0,
  level: 0,
  openUntil: null,
  lastSignal: null,
  updatedAt: new Date().toISOString(),
}

function load(): BreakerState {
  if (!existsSync(STATE_PATH)) return { ...EMPTY }
  try {
    return { ...EMPTY, ...(JSON.parse(readFileSync(STATE_PATH, 'utf8')) as Partial<BreakerState>) }
  } catch {
    return { ...EMPTY }
  }
}

function save(state: BreakerState): void {
  mkdirSync(dirname(STATE_PATH), { recursive: true })
  writeFileSync(STATE_PATH, JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2))
}

export function breakerStatus(): { open: boolean; until: Date | null; points: number; level: number } {
  const state = load()
  const until = state.openUntil ? new Date(state.openUntil) : null
  const open = until !== null && until.getTime() > Date.now()
  return { open, until, points: state.points, level: state.level }
}

/** Sinal negativo soma pontos. Ao cruzar o limiar o breaker abre e o backoff escala. */
export async function recordSignal(signal: Signal, detail?: string): Promise<void> {
  // deslogado nao e bloqueio do Instagram: a sessao so expirou ou foi aberta em
  // outro computador. Travar por horas nao protege nada; basta logar de novo
  if (signal === 'logged_out') {
    logger.warn({ detail }, 'sessao do Instagram deslogada: rode npm run login')
    await notify('Sessao do Instagram deslogada. Rode npm run login.')
    return
  }
  const state = load()
  state.points += WEIGHTS[signal]
  state.lastSignal = signal

  if (state.points >= THRESHOLD) {
    const level = signal === 'challenge' ? BACKOFF_HOURS.length - 1 : Math.min(state.level, BACKOFF_HOURS.length - 1)
    const hours = BACKOFF_HOURS[level] ?? 48
    state.openUntil = new Date(Date.now() + hours * 3_600_000).toISOString()
    state.level = Math.min(level + 1, BACKOFF_HOURS.length - 1)
    state.points = 0
    save(state)
    await notify(`Circuit breaker aberto por ${hours}h. Sinal: ${signal}${detail ? ` (${detail})` : ''}`)
    return
  }

  save(state)
  logger.warn({ signal, points: state.points, detail }, 'sinal negativo registrado')
}

/** Run limpo decai os pontos e, depois de dois seguidos, baixa um nivel de backoff. */
export function recordSuccess(): void {
  const state = load()
  state.points = Math.max(0, state.points - 2)
  if (state.points === 0 && state.level > 0) state.level -= 1
  state.openUntil = null
  save(state)
}

export function resetBreaker(): void {
  save({ ...EMPTY })
}
