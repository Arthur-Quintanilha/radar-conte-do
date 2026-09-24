import { execFile } from 'node:child_process'
import { mkdir, readFile, readdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, extname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { and, eq, isNotNull, isNull, like } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import { db } from '../db/client'
import { enrichment, mediaAsset, post } from '../db/schema'
import { srtToText } from './transcript'
import { config } from '../shared/config'
import { logger } from '../shared/logger'

const run = promisify(execFile)

export const WHISPER_KIND = 'transcript'

/**
 * No Windows, quando a saida de um processo Python vai para um pipe e nao
 * para o console, ele usa a codificacao legada (cp1252). O `--help` do
 * whisper lista idiomas asiaticos e a transcricao pode ter qualquer caractere
 * — os dois morrem com UnicodeEncodeError. Forcar UTF-8 resolve, e e inocuo
 * para backends que nao sao Python, como o whisper.cpp.
 */
const CHILD_ENV: NodeJS.ProcessEnv = { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }

export function whisperModelTag(): string {
  return `whisper:${config.WHISPER_MODEL}`
}

/**
 * Monta o comando a partir do template do .env. Fica como template para
 * aceitar tanto o whisper de referencia quanto o whisper.cpp, que tem
 * interface de linha de comando completamente diferente.
 */
export function buildCommand(template: string, input: string, outdir: string): string[] {
  const substituido = template
    .replaceAll('{input}', input)
    .replaceAll('{outdir}', outdir)
    .replaceAll('{model}', config.WHISPER_MODEL)
    .replaceAll('{lang}', config.WHISPER_LANG)

  // divide respeitando aspas, para caminhos do Windows com espaco
  const partes = substituido.match(/"[^"]*"|\S+/g) ?? []
  return partes.map((p) => (p.startsWith('"') && p.endsWith('"') ? p.slice(1, -1) : p))
}

/** Aceita o que o backend tiver produzido: .txt direto ou .srt para converter. */
export async function readOutput(outdir: string): Promise<string> {
  const arquivos = await readdir(outdir)

  const txt = arquivos.find((f) => f.endsWith('.txt'))
  if (txt) return (await readFile(join(outdir, txt), 'utf8')).replace(/\s+/g, ' ').trim()

  const srt = arquivos.find((f) => f.endsWith('.srt') || f.endsWith('.vtt'))
  if (srt) return srtToText(await readFile(join(outdir, srt), 'utf8'))

  return ''
}

export interface ToolStatus {
  ok: boolean
  /** por que falhou, em portugues, para o usuario agir */
  motivo?: string
}

/**
 * Tenta executar e, se falhar, diz o motivo. "false" sozinho nao ajuda:
 * nao estar no PATH, demorar demais e quebrar ao abrir pedem acoes diferentes.
 */
async function sondar(comando: string, args: string[], timeoutMs: number): Promise<ToolStatus> {
  try {
    await run(comando, args, { timeout: timeoutMs, windowsHide: true, env: CHILD_ENV })
    return { ok: true }
  } catch (error) {
    const e = error as NodeJS.ErrnoException & { killed?: boolean; signal?: string; stderr?: string }
    if (e.code === 'ENOENT') {
      return { ok: false, motivo: `"${comando}" nao esta no PATH deste terminal` }
    }
    if (e.killed || e.signal === 'SIGTERM') {
      return { ok: false, motivo: `"${comando}" nao respondeu em ${timeoutMs / 1000}s` }
    }
    const detalhe = (e.stderr ?? e.message ?? '').trim().split('\n').filter(Boolean).pop()
    return { ok: false, motivo: `"${comando}" abriu mas falhou: ${detalhe ?? 'sem detalhe'}` }
  }
}

export interface WhisperCheck {
  ffmpeg: ToolStatus
  whisper: ToolStatus
  comando: string
}

export async function checkTools(): Promise<WhisperCheck> {
  const comando = buildCommand(config.WHISPER_CMD, 'x', 'y')[0] ?? 'whisper'
  return {
    ffmpeg: await sondar(config.FFMPEG_BIN, ['-version'], 20_000),
    // o whisper importa bibliotecas pesadas ao abrir; no primeiro uso, com o
    // antivirus escaneando, 20s nao bastam
    whisper: await sondar(comando, ['--help'], 90_000),
    comando,
  }
}

export interface WhisperSummary {
  candidates: number
  transcribed: number
  empty: number
  failed: number
}

/** Extrai audio em 16 kHz mono: menor, mais rapido, e todo backend aceita. */
async function extrairAudio(video: string, destino: string): Promise<void> {
  await run(
    config.FFMPEG_BIN,
    ['-y', '-i', video, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', destino],
    { timeout: 180_000 },
  )
}

export async function transcribeVideos(limit = 5): Promise<WhisperSummary> {
  const ferramentas = await checkTools()
  if (!ferramentas.ffmpeg.ok) throw new Error(`ffmpeg: ${ferramentas.ffmpeg.motivo}`)
  if (!ferramentas.whisper.ok) throw new Error(`whisper: ${ferramentas.whisper.motivo}`)

  const modelo = whisperModelTag()
  const feito = alias(enrichment, 'feito')

  const rows = await db
    .select({ postId: post.id, shortcode: post.shortcode, path: mediaAsset.localPath })
    .from(mediaAsset)
    .innerJoin(post, eq(post.id, mediaAsset.postId))
    .leftJoin(feito, and(eq(feito.postId, post.id), eq(feito.kind, WHISPER_KIND), eq(feito.model, modelo)))
    .where(and(eq(mediaAsset.kind, 'video'), isNotNull(mediaAsset.localPath), isNull(feito.id)))
    .limit(limit * 4)

  const pendentes = rows.filter((r) => r.path && existsSync(r.path)).slice(0, limit)
  const summary: WhisperSummary = { candidates: pendentes.length, transcribed: 0, empty: 0, failed: 0 }

  for (const row of pendentes) {
    if (!row.path) continue
    const trabalho = resolve(process.cwd(), config.MEDIA_DIR, '.whisper', row.shortcode)

    try {
      await mkdir(trabalho, { recursive: true })
      const wav = join(trabalho, `${basename(row.path, extname(row.path))}.wav`)

      logger.info({ shortcode: row.shortcode }, 'extraindo audio')
      await extrairAudio(row.path, wav)

      logger.info({ shortcode: row.shortcode, modelo: config.WHISPER_MODEL }, 'transcrevendo')
      const [comando, ...args] = buildCommand(config.WHISPER_CMD, wav, trabalho)
      if (!comando) throw new Error('WHISPER_CMD vazio')
      await run(comando, args, { timeout: 900_000, maxBuffer: 16 * 1024 * 1024, windowsHide: true, env: CHILD_ENV })

      const texto = await readOutput(trabalho)
      if (texto === '') {
        summary.empty++
        logger.warn({ shortcode: row.shortcode }, 'whisper nao produziu texto')
        continue
      }

      await db
        .insert(enrichment)
        .values({
          postId: row.postId,
          kind: WHISPER_KIND,
          model: modelo,
          output: { text: texto, chars: texto.length },
        })
        .onConflictDoUpdate({
          target: [enrichment.postId, enrichment.kind, enrichment.model],
          set: { output: { text: texto, chars: texto.length }, createdAt: new Date() },
        })

      summary.transcribed++
      logger.info({ shortcode: row.shortcode, caracteres: texto.length }, 'transcricao local gravada')
    } catch (error) {
      summary.failed++
      logger.warn(
        { shortcode: row.shortcode, erro: error instanceof Error ? error.message.split('\n')[0] : String(error) },
        'falha ao transcrever',
      )
    } finally {
      await rm(trabalho, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  return summary
}

/** Apaga as transcricoes locais para refaze-las, por exemplo apos mudar o modelo ou o VAD. */
export async function resetWhisper(): Promise<number> {
  const apagadas = await db
    .delete(enrichment)
    .where(and(eq(enrichment.kind, WHISPER_KIND), like(enrichment.model, 'whisper:%')))
    .returning({ id: enrichment.id })
  return apagadas.length
}
