import { mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { servidor } from '../servidor'
import { arquivoDaMidia, arquivoNovo, pastaDoPost } from './local'
import { logger } from '../../comum/logger'
import { humanPause } from '../../comum/human'
import { ingestSubtitles } from './transcript'

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
export async function downloadPending(limit = 1000): Promise<DownloadSummary> {
  const srv = servidor()
  // o servidor manda as midias recentes (a URL do CDN vale poucas horas); o que ja esta no disco fica
  const rows = (await srv.midiasParaBaixar(limit * 4)).filter((m) => !arquivoDaMidia(m.shortcode, m.position, m.kind)).slice(0, limit)

  const summary: DownloadSummary = { attempted: 0, saved: 0, skipped: 0, failed: 0 }
  let expired = 0

  for (const row of rows) {
    summary.attempted++
    const dir = pastaDoPost(row.shortcode)

    try {
      const response = await fetch(row.url)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)

      const contentType = response.headers.get('content-type') ?? ''
      const buffer = Buffer.from(await response.arrayBuffer())
      const limite = MAX_BYTES[row.kind] ?? DEFAULT_MAX_BYTES
      if (buffer.byteLength > limite) throw new Error(`arquivo grande demais: ${buffer.byteLength}`)

      await mkdir(dir, { recursive: true })
      const file = arquivoNovo(row.shortcode, row.position, row.kind, extensionFor(row.kind, contentType))
      await writeFile(file, buffer)
      await srv.midiaBaixada(row.id)

      summary.saved++
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      if (detail.includes('403') || detail.includes('410')) expired++
      await srv.midiaFalhou(row.id, detail)
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
