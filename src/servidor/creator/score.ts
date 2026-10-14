/**
 * A regua da pauta. Tres sinais multiplicados:
 *  - alcance: fracao das sementes que segue o autor (o publico consome isso?)
 *  - desempenho: engajamento do post dividido pela mediana do proprio autor
 *    (o tema acertou, independente do tamanho da conta)
 *  - confianca da IA no encaixe
 * Engajamento absoluto e tamanho do autor quase nao pesam de proposito.
 */

export function mediana(xs: number[]): number | null {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b)
  if (v.length === 0) return null
  const m = Math.floor(v.length / 2)
  return v.length % 2 ? (v[m] as number) : ((v[m - 1] as number) + (v[m] as number)) / 2
}

/** curtidas + comentarios; null quando o Instagram escondeu as curtidas */
export function engajamento(likes: number | null, comments: number | null): number | null {
  if (likes === null || likes === undefined) return null
  return likes + (comments ?? 0)
}

export const DESEMPENHO_MIN = 0.2
export const DESEMPENHO_MAX = 5

/**
 * Quantas vezes o normal daquele autor. Com menos de 3 posts dele no banco
 * nao ha "normal" para comparar: vale 1 (neutro).
 */
export function desempenhoRelativo(e: number | null, doAutor: number[]): number {
  if (e === null || doAutor.length < 3) return 1
  const med = mediana(doAutor)
  if (med === null || med <= 0) return 1
  return Math.min(DESEMPENHO_MAX, Math.max(DESEMPENHO_MIN, e / med))
}

export function alcance(sementesQueSeguem: number, totalSementes: number): number {
  if (totalSementes <= 0) return 0
  return Math.min(1, sementesQueSeguem / totalSementes)
}

export function pontuar(a: { alcance: number; desempenho: number; confianca: number | null }): number {
  const c = a.confianca === null ? 0.6 : Math.min(1, Math.max(0, a.confianca))
  return a.alcance * a.desempenho * (0.5 + 0.5 * c)
}

export interface PostPontuavel {
  postId: string
  autor: string
  likes: number | null
  comments: number | null
  confianca: number | null
}

export interface PostPontuado extends PostPontuavel {
  sementes: number
  alcance: number
  desempenho: number
  score: number
}

/**
 * Pontua uma lista de posts. `historico` traz o engajamento de TODOS os posts
 * de cada autor no banco (nao so os da janela), para a mediana ser estavel.
 */
export function pontuarPosts(
  posts: PostPontuavel[],
  historico: Map<string, number[]>,
  sementesPorAutor: Map<string, number>,
  totalSementes: number,
): PostPontuado[] {
  return posts
    .map((p) => {
      const sementes = sementesPorAutor.get(p.autor) ?? 0
      const al = alcance(sementes, totalSementes)
      const de = desempenhoRelativo(engajamento(p.likes, p.comments), historico.get(p.autor) ?? [])
      return { ...p, sementes, alcance: al, desempenho: de, score: pontuar({ alcance: al, desempenho: de, confianca: p.confianca }) }
    })
    .sort((a, b) => b.score - a.score)
}

/** "corrida", "Corrida de rua " e "corridas" caem no mesmo balde do radar. */
export function chaveTema(t: string): string {
  return t
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/s\b/g, '')
}
