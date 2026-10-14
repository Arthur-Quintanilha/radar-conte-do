import { existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { config } from '../../comum/config'

/**
 * Onde as mídias moram no computador. Cada post tem uma pasta com o shortcode e
 * cada arquivo se chama <posição>-<tipo>.<extensão> (ex.: 0-image.jpg,
 * 0-video.mp4, 0-subtitle.srt). O banco não guarda caminho nenhum: cada máquina
 * tem os arquivos do que ela mesma coletou, e acha pelo nome.
 */

export const pastaDasMidias = (): string => resolve(process.cwd(), config.MEDIA_DIR)

const seguro = (shortcode: string): string => {
  if (!/^[\w-]+$/.test(shortcode)) throw new Error(`shortcode invalido: ${shortcode}`)
  return shortcode
}

export const pastaDoPost = (shortcode: string): string => join(pastaDasMidias(), seguro(shortcode))

/** caminho de um arquivo novo; a extensão vem do tipo do conteúdo baixado */
export const arquivoNovo = (shortcode: string, position: number, kind: string, ext: string): string =>
  join(pastaDoPost(shortcode), `${position}-${kind}${ext}`)

export interface ArquivoLocal {
  position: number
  kind: string
  path: string
}

/** os arquivos já baixados de um post, em ordem de posição */
export function arquivosDoPost(shortcode: string): ArquivoLocal[] {
  let pasta: string
  try {
    pasta = pastaDoPost(shortcode)
  } catch {
    return []
  }
  if (!existsSync(pasta)) return []
  const out: ArquivoLocal[] = []
  for (const nome of readdirSync(pasta)) {
    const m = /^(\d+)-(image|video|subtitle)\.\w+$/.exec(nome)
    if (m) out.push({ position: Number(m[1]), kind: m[2]!, path: join(pasta, nome) })
  }
  // vídeo antes da imagem na mesma posição (a capa do reel é a imagem 0)
  return out.sort((a, b) => a.position - b.position || (a.kind === 'video' ? -1 : b.kind === 'video' ? 1 : 0))
}

/** o arquivo de uma mídia, se já foi baixado */
export function arquivoDaMidia(shortcode: string, position: number, kind: string): string | null {
  return arquivosDoPost(shortcode).find((a) => a.position === position && a.kind === kind)?.path ?? null
}
