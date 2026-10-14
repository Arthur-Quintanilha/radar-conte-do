import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { ehDeImagem, type FonteImagens, type Imagem } from '../../comum/imagens'
import { arquivosDoPost } from './local'
import { config } from '../../comum/config'
import { logger } from '../../comum/logger'

const run = promisify(execFile)

export type { Imagem }

/** "Duration: 00:00:41.23" do cabecalho que o ffmpeg imprime ao abrir o arquivo. */
export function duracaoDoCabecalho(stderr: string): number | null {
  const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr)
  if (!m) return null
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
}

export async function duracaoDoVideo(arquivo: string): Promise<number | null> {
  try {
    await run(config.FFMPEG_BIN, ['-hide_banner', '-i', arquivo], { timeout: 30_000, windowsHide: true })
    return null
  } catch (error) {
    // sem arquivo de saida o ffmpeg sai com erro, mas o cabecalho vem no stderr
    return duracaoDoCabecalho(String((error as { stderr?: unknown }).stderr ?? ''))
  }
}

/** Momentos do video para tirar quadros: inicio (o gancho) e espalhados ate o fim. */
export function momentos(duracao: number, n: number): number[] {
  if (duracao <= 0) return [0]
  const fixos = [Math.min(0.5, duracao / 10), Math.min(2.5, duracao / 4)]
  const resto = Array.from({ length: Math.max(0, n - fixos.length) }, (_, i) => (duracao * (i + 1)) / (n - fixos.length + 1))
  return [...new Set([...fixos, ...resto].map((t) => Math.round(Math.min(t, Math.max(0, duracao - 0.3)) * 10) / 10))].sort((a, b) => a - b)
}

/**
 * O que a IA precisa VER do post para copiar o formato: quadros do video
 * (gancho e ao longo dele) ou as primeiras imagens do carrossel, pequenos.
 */
/** maxQuadros vale para video; maxSlides para carrossel (0 em maxQuadros desliga os dois). */
export async function quadrosDoPost(shortcode: string, maxQuadros = 6, maxSlides = 10, largura = 480): Promise<{ imagens: Imagem[]; duracao: number | null }> {
  const assets = arquivosDoPost(shortcode)
  const video = assets.find((a) => a.kind === 'video')
  const imagens: Imagem[] = []
  let duracao: number | null = null

  if (video?.path) {
    duracao = await duracaoDoVideo(video.path)
    const pasta = await mkdtemp(join(tmpdir(), 'quadros-'))
    try {
      for (const t of momentos(duracao ?? 10, maxQuadros)) {
        const saida = join(pasta, `q-${t}.jpg`)
        try {
          await run(config.FFMPEG_BIN, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(t), '-i', video.path, '-frames:v', '1', '-vf', 'scale=360:-2', '-q:v', '6', saida], { timeout: 60_000, windowsHide: true })
          imagens.push({ mime: 'image/jpeg', base64: (await readFile(saida)).toString('base64'), rotulo: `quadro em ${t.toFixed(1).replace('.', ',')}s` })
        } catch (error) {
          logger.debug({ t, erro: error instanceof Error ? error.message : String(error) }, 'quadro nao extraido')
        }
      }
    } finally {
      await rm(pasta, { recursive: true, force: true }).catch(() => undefined)
    }
    return { imagens, duracao }
  }

  // carrossel ou foto: as imagens em ordem, encolhidas pelo ffmpeg quando der
  const fotos = assets.filter((a) => a.kind === 'image').slice(0, maxQuadros ? maxSlides : 0)
  const pasta = await mkdtemp(join(tmpdir(), 'quadros-'))
  try {
    for (const f of fotos) {
      const saida = join(pasta, `s-${f.position}.jpg`)
      try {
        await run(config.FFMPEG_BIN, ['-hide_banner', '-loglevel', 'error', '-y', '-i', f.path!, '-vf', `scale=${largura}:-2`, '-q:v', '5', saida], { timeout: 60_000, windowsHide: true })
        imagens.push({ mime: 'image/jpeg', base64: (await readFile(saida)).toString('base64'), rotulo: `slide ${f.position + 1}` })
      } catch {
        // sem ffmpeg: manda o arquivo como esta, se for jpg
        if (/\.jpe?g$/i.test(f.path!)) imagens.push({ mime: 'image/jpeg', base64: (await readFile(f.path!)).toString('base64'), rotulo: `slide ${f.position + 1}` })
      }
    }
  } finally {
    await rm(pasta, { recursive: true, force: true }).catch(() => undefined)
  }
  return { imagens, duracao }
}

export { ehDeImagem }

/**
 * Slides de varios posts de uma vez, para a IA ler o texto de carrossel e foto.
 * Rotulo "post SHORTCODE · slide N". Teto total abaixo do limite de imagens da API.
 */
export async function slidesDosPosts(
  posts: { shortcode: string; tipo: string | null }[],
  porPost: number,
  largura: number,
  teto = 90,
): Promise<{ imagens: Imagem[]; porShortcode: Map<string, number> }> {
  const imagens: Imagem[] = []
  const porShortcode = new Map<string, number>()
  for (const p of posts) {
    if (!ehDeImagem(p.tipo) || imagens.length >= teto) continue
    try {
      const q = await quadrosDoPost(p.shortcode, 1, Math.min(porPost, teto - imagens.length), largura)
      for (const im of q.imagens) imagens.push({ ...im, rotulo: `post ${p.shortcode} · ${im.rotulo}` })
      if (q.imagens.length) porShortcode.set(p.shortcode, q.imagens.length)
    } catch (error) {
      logger.debug({ shortcode: p.shortcode, erro: error instanceof Error ? error.message : String(error) }, 'slides nao lidos')
    }
  }
  return { imagens, porShortcode }
}

/** As imagens tiradas dos arquivos deste computador, para a IA. */
export const imagensLocais: FonteImagens = { quadrosDoPost, slidesDosPosts }
