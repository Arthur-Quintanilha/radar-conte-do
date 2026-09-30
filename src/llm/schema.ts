import { z } from 'zod'

/**
 * Versao de cada prompt. Subir a versao faz o painel oferecer de novo os itens
 * avaliados com a versao antiga. Contas v2: passou a pedir "acompanhar".
 * Posts v2: anuncio vale no maximo media, alta exige substancia, campo formato.
 */
export const CONTAS_VERSION = 'v2'
export const POSTS_VERSION = 'v2'
export const SELECAO_VERSION = 'v1'
/** @deprecated use CONTAS_VERSION / POSTS_VERSION */
export const PROMPT_VERSION = POSTS_VERSION

export const AUTHOR_CLASSES = ['concorrente', 'referencia_lideranca', 'referencia_produto', 'publico', 'fora'] as const
export type AuthorClass = (typeof AUTHOR_CLASSES)[number]

export const RELEVANCES = ['alta', 'media', 'baixa'] as const
export type Relevance = (typeof RELEVANCES)[number]

export const AUDIENCES = ['comprador', 'dev', 'geral'] as const

export const FORMATS = ['anuncio', 'educativo', 'opiniao', 'case', 'bastidor', 'noticia', 'meme', 'outro'] as const
export type Format = (typeof FORMATS)[number]

// a LLM as vezes escreve com acento, maiuscula ou "referência: produto"
function normalizar(v: unknown): unknown {
  if (typeof v !== 'string') return v
  return v
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()
    .replace(/[\s:.-]+/g, '_')
}

const confianca = z.preprocess(
  (v) => (typeof v === 'string' ? Number(v.replace(',', '.').replace('%', '')) : v),
  z.number().min(0).max(100).transform((n) => (n > 1 ? n / 100 : n)),
)

export const authorAnswer = z.object({
  id: z.string().min(1),
  classe: z.preprocess(normalizar, z.enum(AUTHOR_CLASSES)),
  confianca,
  motivo: z.string().min(1).max(600),
  sinais: z.array(z.string().max(200)).max(10).optional().default([]),
  /** vale visitar o perfil de tempos em tempos? Aceita sim/nao, true/false */
  acompanhar: z
    .preprocess((v) => {
      if (typeof v === 'boolean') return v
      const t = normalizar(v)
      if (t === 'sim' || t === 'true' || t === 's' || t === 'yes') return true
      if (t === 'nao' || t === 'false' || t === 'n' || t === 'no') return false
      return v
    }, z.boolean())
    .optional(),
})
export type AuthorAnswer = z.infer<typeof authorAnswer>

export const postAnswer = z.object({
  id: z.string().min(1),
  relevancia: z.preprocess(normalizar, z.enum(RELEVANCES)),
  publico: z.preprocess(normalizar, z.enum(AUDIENCES)).optional(),
  /** v2. Formato desconhecido vira "outro" em vez de derrubar o item */
  formato: z
    .preprocess((v) => {
      const t = normalizar(v)
      if (t === undefined || t === null || t === '') return undefined
      return (FORMATS as readonly unknown[]).includes(t) ? t : 'outro'
    }, z.enum(FORMATS))
    .optional(),
  tema: z.string().max(120).optional().default(''),
  angulo: z.string().max(600).optional().default(''),
  confianca,
  motivo: z.string().min(1).max(600),
})
export type PostAnswer = z.infer<typeof postAnswer>

/** Uma conta escolhida na rodada de selecao: posicao no ranking e o porque. */
export const selecaoItem = z.object({
  id: z.string().min(1),
  posicao: z.coerce.number().int().min(1).optional(),
  motivo: z.string().min(1).max(600),
})
export type SelecaoItem = z.infer<typeof selecaoItem>

/** abaixo disso a classificacao aparece como "revisar" */
export const CONFIANCA_MINIMA = 0.6
