import { readFile } from 'node:fs/promises'
import { and, eq, isNotNull, isNull } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { db } from '../db/client'
import { enrichment, mediaAsset, post } from '../db/schema'
import { logger } from '../shared/logger'

export const TRANSCRIPT_KIND = 'transcript'
const TRANSCRIPT_MODEL = 'instagram'

const TIMECODE_RE = /^\d{2}:\d{2}:\d{2}[,.]\d{3}\s*-->/
const TAG_RE = /<[^>]+>/g

export interface TranscriptSummary {
  candidates: number
  saved: number
  empty: number
  failed: number
}

/**
 * Converte SRT em texto corrido.
 *
 * A legenda automatica repete a frase anterior a cada bloco enquanto a pessoa
 * fala, entao juntar tudo cru triplica o texto. Blocos repetidos e linhas que
 * apenas estendem a anterior sao colapsados.
 */
export function srtToText(srt: string): string {
  const blocks = srt.replace(/\r/g, '').split(/\n{2,}/)
  const linhas: string[] = []

  for (const block of blocks) {
    const texto = block
      .split('\n')
      .filter((line) => line.trim() !== '' && !/^\d+$/.test(line.trim()) && !TIMECODE_RE.test(line.trim()))
      .join(' ')
      .replace(TAG_RE, '')
      .replace(/\s+/g, ' ')
      .trim()

    if (texto === '') continue

    const anterior = linhas[linhas.length - 1]
    if (anterior === undefined) {
      linhas.push(texto)
      continue
    }
    if (texto === anterior) continue
    // bloco que so acrescenta palavras ao anterior substitui o anterior
    if (texto.startsWith(anterior)) {
      linhas[linhas.length - 1] = texto
      continue
    }
    if (anterior.endsWith(texto)) continue

    linhas.push(texto)
  }

  return linhas.join(' ').replace(/\s+/g, ' ').trim()
}

/** Le os .srt ja baixados e grava a transcricao. Nao toca a rede. */
export async function ingestSubtitles(limit = 200): Promise<TranscriptSummary> {
  const feito = alias(enrichment, 'feito')

  const rows = await db
    .select({ postId: post.id, shortcode: post.shortcode, path: mediaAsset.localPath })
    .from(mediaAsset)
    .innerJoin(post, eq(post.id, mediaAsset.postId))
    .leftJoin(
      feito,
      and(eq(feito.postId, post.id), eq(feito.kind, TRANSCRIPT_KIND), eq(feito.model, TRANSCRIPT_MODEL)),
    )
    .where(and(eq(mediaAsset.kind, 'subtitle'), isNotNull(mediaAsset.localPath), isNull(feito.id)))
    .limit(limit)

  const summary: TranscriptSummary = { candidates: rows.length, saved: 0, empty: 0, failed: 0 }

  for (const row of rows) {
    if (!row.path) continue
    try {
      const texto = srtToText(await readFile(row.path, 'utf8'))
      if (texto === '') {
        summary.empty++
        continue
      }

      await db
        .insert(enrichment)
        .values({
          postId: row.postId,
          kind: TRANSCRIPT_KIND,
          model: TRANSCRIPT_MODEL,
          output: { text: texto, chars: texto.length },
        })
        .onConflictDoUpdate({
          target: [enrichment.postId, enrichment.kind, enrichment.model],
          set: { output: { text: texto, chars: texto.length }, createdAt: new Date() },
        })

      summary.saved++
      logger.info({ shortcode: row.shortcode, caracteres: texto.length }, 'transcricao gravada')
    } catch (error) {
      summary.failed++
      logger.warn({ shortcode: row.shortcode, error }, 'falha ao ler legenda')
    }
  }

  return summary
}
