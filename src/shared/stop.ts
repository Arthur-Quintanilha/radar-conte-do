import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

export class StopRequested extends Error {
  constructor() {
    super('arquivo STOP presente na raiz do projeto')
    this.name = 'StopRequested'
  }
}

const stopPath = resolve(process.cwd(), 'STOP')

export function isStopRequested(): boolean {
  return existsSync(stopPath)
}

/** Chamado antes de cada acao do coletor. Criar o arquivo STOP aborta tudo. */
export function assertNotStopped(): void {
  if (isStopRequested()) throw new StopRequested()
}
