import { mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { and, asc, desc, eq, isNull, lt, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { mediaAsset, post } from '../db/schema'
import { config } from '../shared/config'
import { logger } from '../shared/logger'
import { humanPause } from '../shared/human'
import { ingestSubtitles } from './transcript'

const MAX_ATTEMPTS = 3
/** Imagem de 720px passa longe de 12 MB; um reel de 1 a 2 minutos passa dos 20. */
const MAX_BYTES: Record<string, number> = {
  image: 12 * 1024 * 1024,
  subtitle: 2 * 1024 * 1024,
  video: 120 * 1024 * 1024,
}
const DEFAULT_MAX_BYTES = 12 * 1024 * 1024

export interface DownloadSummary {
  attempted: number
  saved: number
  skipped: number
  failed: number
}

function extensionFor(kind: string, contentType: string): string {
  if (kind === 'subtitle') return '.srt'
  if (kind === 'video') return contentType.includes('webm') ? '.webm' : '.mp4'
  if (contentType.includes('png')) return '.png'
  if (contentType.includes('webp')) return '.webp'
  return '.jpg'
}

/**
 * As URLs do CDN do Instagram sao assinadas e expiram em algumas horas.
 * Baixar logo apos a coleta e o que faz diferenca; URL velha da 403 e o
 * asset fica marcado para nao ser tentado para sempre.
 */
/**
 * Ordem de download. Capa primeiro: sem ela o post fica sem imagem no painel e
 * sem entrada para analise visual. Legenda .srt logo depois, porque e minuscula
 * e expira igual. Os demais slides e os videos, que sao pesados, por ultimo.
 * Antes disso a fila nao tinha prioridade: um carrossel de 16 slides consumia
 * a cota inteira antes de outros posts ganharem a primeira imagem.
 */
const PRIORIDADE = sql`case
  when ${mediaAsset.kind} = 'image' and ${mediaAsset.position} = 0 then 0
  when ${mediaAsset.kind} = 'subtitle' then 1
  when ${mediaAsset.kind} = 'image' then 2
  else 3 end`

export async function downloadPending(limit = 1000): Promise<DownloadSummary> {
  const rows = await db
    .select({
      id: mediaAsset.id,
      postId: mediaAsset.postId,
      position: mediaAsset.position,
      kind: mediaAsset.kind,
      url: mediaAsset.remoteUrl,
      attempts: mediaAsset.downloadAttempts,
      shortcode: post.shortcode,
    })
    .from(mediaAsset)
    .innerJoin(post, eq(post.id, mediaAsset.postId))
    .where(and(isNull(mediaAsset.localPath), lt(mediaAsset.downloadAttempts, MAX_ATTEMPTS)))
    .orderBy(PRIORIDADE, asc(mediaAsset.downloadAttempts), desc(post.firstSeenAt), asc(mediaAsset.position))
    .limit(limit)

  const summary: DownloadSummary = { attempted: 0, saved: 0, skipped: 0, failed: 0 }
  let expired = 0

  for (const row of rows) {
    if (!row.url) {
      summary.skipped++
      continue
    }

    summary.attempted++
    const dir = resolve(process.cwd(), config.MEDIA_DIR, row.shortcode)

    try {
      const response = await fetch(row.url)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)

      const contentType = response.headers.get('content-type') ?? ''
      const buffer = Buffer.from(await response.arrayBuffer())
      const limite = MAX_BYTES[row.kind] ?? DEFAULT_MAX_BYTES
      if (buffer.byteLength > limite) throw new Error(`arquivo grande demais: ${buffer.byteLength}`)

      await mkdir(dir, { recursive: true })
      const file = join(dir, `${row.position}-${row.kind}${extensionFor(row.kind, contentType)}`)
      await writeFile(file, buffer)

      await db
        .update(mediaAsset)
        .set({
          localPath: file,
          downloadedAt: new Date(),
          downloadAttempts: row.attempts + 1,
          downloadError: null,
        })
        .where(eq(mediaAsset.id, row.id))

      summary.saved++
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      if (detail.includes('403') || detail.includes('410')) expired++
      await db
        .update(mediaAsset)
        .set({ downloadAttempts: row.attempts + 1, downloadError: detail })
        .where(eq(mediaAsset.id, row.id))
      summary.failed++
      logger.warn({ shortcode: row.shortcode, position: row.position, erro: detail }, 'download falhou')
    }

    await humanPause(350, { min: 120, max: 1_500 })
  }

  // os .srt recem-baixados viram transcricao na hora; e so leitura de arquivo
  const transcricoes = await ingestSubtitles()
  if (transcricoes.saved > 0) logger.info(transcricoes, 'transcricoes do Instagram gravadas')

  if (summary.attempted > 0 && summary.saved === 0 && expired > 0) {
    logger.warn(
      { expiradas: expired },
      'as URLs do CDN expiraram — rode uma coleta nova e baixe logo depois do parse',
    )
  }

  return summary
}

export function hasLocalFile(path: string | null): boolean {
  return path !== null && existsSync(path)
}
