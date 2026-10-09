import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

/** Onde o ultimo ciclo parou: o painel usa para "continuar de onde parou". */
export const ARQUIVO_CICLO = resolve(process.cwd(), 'data', 'ciclo.json')
export interface EstadoCiclo {
  personaId: string
  etapas: string[]
  feitas: string[]
  minimo: number | null
  refazerPauta: boolean
  inicio: number
  fim: number | null
}
export function gravarCiclo(e: EstadoCiclo): void {
  try {
    mkdirSync(dirname(ARQUIVO_CICLO), { recursive: true })
    writeFileSync(ARQUIVO_CICLO, JSON.stringify(e, null, 1), 'utf8')
  } catch {
    // sem disco: so perde o "continuar"
  }
}
export function lerCiclo(): EstadoCiclo | null {
  try {
    return existsSync(ARQUIVO_CICLO) ? (JSON.parse(readFileSync(ARQUIVO_CICLO, 'utf8')) as EstadoCiclo) : null
  } catch {
    return null
  }
}

