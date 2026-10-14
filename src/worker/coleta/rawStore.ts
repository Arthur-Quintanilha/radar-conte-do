import { appendFileSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import { servidor } from '../servidor'
import { config } from '../../comum/config'
import { logger } from '../../comum/logger'
import type { Captured } from './interceptor'

/**
 * Append-only. O payload bruto e o ativo do projeto: parser voce reescreve
 * varias vezes, coleta voce nao quer repetir.
 *
 * Grava em dois lugares de proposito: o JSONL fica no computador e sobrevive a
 * qualquer problema de rede ou de banco; o servidor recebe a captura e faz o parse.
 */
export class RawStore {
  private readonly filePath: string
  private saved = 0

  constructor(private readonly runId: string) {
    const dir = resolve(process.cwd(), config.RAW_DIR)
    mkdirSync(dir, { recursive: true })
    this.filePath = join(dir, `${runId}.jsonl`)
  }

  async save(captured: Captured): Promise<void> {
    const json = JSON.stringify(captured.body)
    const bodyHash = createHash('sha256').update(json).digest('hex')

    const record = {
      runId: this.runId,
      url: captured.url,
      pageUrl: captured.pageUrl,
      endpointKind: captured.kind,
      status: captured.status,
      bodyHash,
      capturedAt: captured.capturedAt.toISOString(),
      body: captured.body,
    }

    try {
      appendFileSync(this.filePath, `${JSON.stringify(record)}\n`)
    } catch (error) {
      logger.warn({ error }, 'falha ao escrever JSONL')
    }

    await servidor().salvarCaptura(this.runId, {
      url: captured.url,
      pageUrl: captured.pageUrl,
      kind: captured.kind,
      status: captured.status,
      body: captured.body,
      bodyHash,
      capturedAt: captured.capturedAt.getTime(),
    })

    this.saved++
  }

  get count(): number {
    return this.saved
  }

  get path(): string {
    return this.filePath
  }
}
