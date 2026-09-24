import { describe, expect, it } from 'vitest'
import { isRestDay } from '../src/shared/budget'

function diasDoAno(ano: number): string[] {
  const out: string[] = []
  const d = new Date(Date.UTC(ano, 0, 1))
  while (d.getUTCFullYear() === ano) {
    out.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}

describe('isRestDay', () => {
  it('fica desligado quando a contagem e zero', () => {
    for (const dia of diasDoAno(2026)) expect(isRestDay(dia, 0)).toBe(false)
  })

  it('e deterministico', () => {
    expect(isRestDay('2026-09-22', 2)).toBe(isRestDay('2026-09-22', 2))
  })

  it('nunca passa de 2 folgas na mesma semana', () => {
    const porSemana = new Map<string, number>()
    for (const dia of diasDoAno(2026)) {
      if (!isRestDay(dia, 2)) continue
      // agrupa pela segunda-feira da semana
      const d = new Date(`${dia}T00:00:00Z`)
      d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
      const semana = d.toISOString().slice(0, 10)
      porSemana.set(semana, (porSemana.get(semana) ?? 0) + 1)
    }
    const maximo = Math.max(...porSemana.values())
    expect(maximo).toBe(2)
  })

  it('nunca produz mais de 4 dias parados seguidos', () => {
    // o pior caso legitimo e folga na sexta e no sabado de uma semana
    // seguidas de folga no domingo e na segunda da seguinte
    let pior = 0
    let atual = 0
    for (const dia of diasDoAno(2026)) {
      atual = isRestDay(dia, 2) ? atual + 1 : 0
      pior = Math.max(pior, atual)
    }
    expect(pior).toBeLessThanOrEqual(4)
  })

  it('a taxa fica perto de 2 em 7', () => {
    const dias = diasDoAno(2026)
    const folgas = dias.filter((d) => isRestDay(d, 2)).length
    expect(folgas / dias.length).toBeGreaterThan(0.24)
    expect(folgas / dias.length).toBeLessThan(0.32)
  })
})
