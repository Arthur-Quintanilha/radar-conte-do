import type { Page } from 'patchright'

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

export function pick<T>(items: readonly T[]): T {
  const value = items[randInt(0, items.length - 1)]
  if (value === undefined) throw new Error('pick() recebeu lista vazia')
  return value
}

/**
 * Amostra log-normal. Pausa humana tem cauda longa: a maioria curta,
 * algumas bem mais longas. Uniforme entre A e B nao se parece com gente.
 */
export function logNormalMs(medianMs: number, sigma = 0.45): number {
  const u1 = Math.random() || 1e-9
  const u2 = Math.random()
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
  return Math.round(medianMs * Math.exp(sigma * z))
}

export async function humanPause(medianMs: number, opts: { min?: number; max?: number } = {}): Promise<number> {
  const min = opts.min ?? Math.round(medianMs * 0.25)
  const max = opts.max ?? Math.round(medianMs * 5)
  const ms = Math.min(Math.max(logNormalMs(medianMs), min), max)
  await sleep(ms)
  return ms
}

/** Scroll em varios incrementos com curva de aceleracao, as vezes voltando um pouco. */
export async function humanScroll(page: Page, distance = 900): Promise<void> {
  const steps = randInt(8, 16)
  let done = 0
  for (let i = 0; i < steps; i++) {
    const t = (i + 1) / steps
    const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
    const target = Math.round(distance * ease)
    const delta = target - done
    done = target
    if (delta > 0) await page.mouse.wheel(0, delta)
    await sleep(randInt(18, 70))
  }
  if (Math.random() < 0.25) {
    await page.mouse.wheel(0, -randInt(40, 180))
    await sleep(randInt(150, 450))
  }
}

/** Move o mouse em varios passos em vez de teleportar. */
export async function humanMouseTo(page: Page, x: number, y: number): Promise<void> {
  await page.mouse.move(x, y, { steps: randInt(8, 20) })
  await sleep(randInt(40, 160))
}

/** Tempo de "leitura" proporcional ao tamanho do conteudo, com piso e teto. */
export async function readingPause(charCount: number): Promise<number> {
  const median = Math.min(12_000, Math.max(1_800, charCount * 22))
  return humanPause(median, { min: 1_200, max: 20_000 })
}
