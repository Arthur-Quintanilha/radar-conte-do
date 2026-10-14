import { execFile } from 'node:child_process'
import { mkdir, readFile, readdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, extname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { availableParallelism } from 'node:os'
import { servidor } from '../servidor'
import type { FilaWhisper } from '../../comum/porta'
import { arquivoDaMidia } from './local'
import { srtToText } from './transcript'
import { config } from '../../comum/config'
import { logger } from '../../comum/logger'
import { isStopRequested } from '../../comum/stop'

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
export function buildCommand(template: string, input: string, outdir: string, threads?: number): string[] {
  const substituido = template
    .replaceAll('{input}', input)
    .replaceAll('{outdir}', outdir)
    .replaceAll('{model}', config.WHISPER_MODEL)
    .replaceAll('{lang}', config.WHISPER_LANG)
    .replaceAll('{threads}', String(threads ?? 0))

  // divide respeitando aspas, para caminhos do Windows com espaco
  const partes = (substituido.match(/"[^"]*"|\S+/g) ?? []).map((p) => (p.startsWith('"') && p.endsWith('"') ? p.slice(1, -1) : p))
  // whisper-ctranslate2 sem --threads no template: divide os nucleos entre os processos em paralelo
  if (threads && !template.includes('{threads}') && !/--threads\b/.test(template) && /whisper-ctranslate2/i.test(partes[0] ?? '')) {
    partes.push('--threads', String(threads))
  }
  return partes
}

const duracao = (ms: number): string => {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.round(s / 60)
  return m < 60 ? `${m}min` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`
}

/**
 * Linha de andamento da fila: quantos ja foram, quantos rodam juntos, o
 * ritmo medio (tempo de parede por video, ja contando o paralelismo) e a
 * previsao para acabar.
 */
export function progresso(feitos: number, total: number, emParalelo: number, decorridoMs: number) {
  const porVideo = decorridoMs / Math.max(1, feitos)
  return {
    video: `${feitos}/${total}`,
    emParalelo,
    ritmo: `${duracao(porVideo)} por vídeo`,
    faltam: feitos < total ? `~${duracao(porVideo * (total - feitos))}` : '0',
  }
}

/**
 * Quantos whisper rodam juntos e com quantas threads cada. Um processo sozinho
 * nao usa a CPU toda (o ctranslate2 para em ~4 threads), entao rodar varios
 * em paralelo e o que mais acelera. WHISPER_PARALELO=0 escolhe pelos nucleos.
 */
export function paralelismo(nucleos = availableParallelism()): { processos: number; threads: number } {
  const processos = config.WHISPER_PARALELO > 0 ? config.WHISPER_PARALELO : Math.max(1, Math.min(4, Math.floor(nucleos / 4)))
  return { processos, threads: Math.max(1, Math.floor(nucleos / processos)) }
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
  /** sem fala: so musica, silencio ou video sem trilha de audio. Fica gravado e nao e refeito */
  empty: number
  failed: number
}

/** ffmpeg recusa extrair audio de um video que nao tem trilha de audio. */
function semTrilhaDeAudio(error: unknown): boolean {
  const e = error as { stderr?: unknown; message?: unknown }
  const texto = `${String(e?.stderr ?? '')}\n${String(e?.message ?? '')}`
  return /does not contain any stream|matches no streams|Output file .* does not contain/i.test(texto)
}

/** Extrai audio em 16 kHz mono: menor, mais rapido, e todo backend aceita. */
async function extrairAudio(video: string, destino: string): Promise<void> {
  await run(
    config.FFMPEG_BIN,
    ['-y', '-i', video, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', destino],
    { timeout: 180_000 },
  )
}

async function gravar(postId: string, modelo: string, texto: string): Promise<void> {
  await servidor().gravarTranscricao(postId, modelo, texto)
}

export type { FilaWhisper }

/**
 * Transcreve os videos baixados que ainda nao tem whisper. A fila vai do que
 * importa para a pauta (contas da persona, dentro da janela) para o resto, e
 * do mais novo para o mais velho; sem ordem, a fila pegava video antigo do
 * Explorar e deixava os reels das referencias para depois.
 */
/** limit 0 = todos os pendentes da fila */
export async function transcribeVideos(limit = 30, fila: FilaWhisper = {}): Promise<WhisperSummary> {
  const ferramentas = await checkTools()
  if (!ferramentas.ffmpeg.ok) throw new Error(`ffmpeg: ${ferramentas.ffmpeg.motivo}`)
  if (!ferramentas.whisper.ok) throw new Error(`whisper: ${ferramentas.whisper.motivo}`)

  const modelo = whisperModelTag()
  if (fila.somenteAutores && !(fila.autores ?? []).length) return { candidates: 0, transcribed: 0, empty: 0, failed: 0 }
  // o servidor sabe quais videos ainda nao tem transcricao; o arquivo e daqui
  const rows = (await servidor().videosSemTranscricao(modelo, fila, limit > 0 ? limit * 4 : 0)).map((r) => ({
    ...r,
    path: arquivoDaMidia(r.shortcode, r.position, 'video'),
  }))

  // um video por post: carrossel com dois videos nao pode rodar duas vezes em paralelo na mesma pasta
  const vistos = new Set<string>()
  const pendentes = rows
    .filter((r) => r.path && existsSync(r.path) && !vistos.has(r.postId) && Boolean(vistos.add(r.postId)))
    .slice(0, limit > 0 ? limit : undefined)
  const summary: WhisperSummary = { candidates: pendentes.length, transcribed: 0, empty: 0, failed: 0 }

  const { processos, threads } = paralelismo()
  if (pendentes.length > 1) logger.info({ videos: pendentes.length, processos, threadsPorProcesso: threads }, 'fila do whisper')
  let proximo = 0
  let feitos = 0
  let ativos = 0
  const inicio = Date.now()

  const transcreverUm = async (row: (typeof pendentes)[number]): Promise<void> => {
    if (!row.path) return
    ativos++
    const trabalho = resolve(process.cwd(), config.MEDIA_DIR, '.whisper', row.shortcode)
    try {
      await mkdir(trabalho, { recursive: true })
      const wav = join(trabalho, `${basename(row.path, extname(row.path))}.wav`)
      try {
        await extrairAudio(row.path, wav)
      } catch (error) {
        if (!semTrilhaDeAudio(error)) throw error
        await gravar(row.postId, modelo, '')
        summary.empty++
        logger.info({ shortcode: row.shortcode }, 'video sem trilha de audio; marcado como sem fala')
        return
      }

      const [comando, ...args] = buildCommand(config.WHISPER_CMD, wav, trabalho, threads)
      if (!comando) throw new Error('WHISPER_CMD vazio')
      await run(comando, args, { timeout: 900_000, maxBuffer: 16 * 1024 * 1024, windowsHide: true, env: { ...CHILD_ENV, OMP_NUM_THREADS: String(threads) } })

      const texto = await readOutput(trabalho)
      // o filtro de voz (VAD) corta musica e silencio; sem fala, grava vazio
      // para nao tentar de novo o mesmo video a cada execucao
      await gravar(row.postId, modelo, texto)
      if (texto === '') {
        summary.empty++
        logger.info({ shortcode: row.shortcode }, 'sem fala no video (so musica ou silencio)')
        return
      }
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
      feitos++
      ativos--
      if (pendentes.length > 1) logger.info(progresso(feitos, pendentes.length, ativos + 1, Date.now() - inicio), 'fila do whisper')
    }
  }

  // N processos do whisper ao mesmo tempo, cada um pegando o proximo da fila
  const trabalhador = async (): Promise<void> => {
    while (proximo < pendentes.length && !isStopRequested()) {
      const row = pendentes[proximo++]!
      await transcreverUm(row)
    }
  }
  await Promise.all(Array.from({ length: Math.min(processos, pendentes.length) }, trabalhador))
  if (feitos > 1) logger.info({ videos: feitos, tempo: duracao(Date.now() - inicio), media: duracao((Date.now() - inicio) / feitos) + ' por vídeo' }, 'whisper terminou')

  return summary
}

/** Quantos videos daquela fila (ja baixados neste computador) ainda esperam transcricao. */
export async function pendentesWhisper(fila: FilaWhisper): Promise<number> {
  if (fila.somenteAutores && !(fila.autores ?? []).length) return 0
  const rows = await servidor().videosSemTranscricao(whisperModelTag(), fila, 0)
  return new Set(rows.filter((r) => arquivoDaMidia(r.shortcode, r.position, 'video')).map((r) => r.postId)).size
}

/** Apaga as transcricoes locais para refaze-las, por exemplo apos mudar o modelo ou o VAD. */
export async function resetWhisper(): Promise<number> {
  return servidor().apagarTranscricoesWhisper()
}
