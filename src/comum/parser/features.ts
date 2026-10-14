import { config } from '../config'

export interface PostFeatures {
  // legenda
  captionLength: number
  lineCount: number
  firstLine: string
  hashtagCount: number
  mentionCount: number
  emojiCount: number
  upperRatio: number
  hasQuestion: boolean
  hookType: HookType
  ctaType: CtaType
  // midia
  aspect: 'vertical' | 'quadrado' | 'horizontal' | 'desconhecido'
  aspectRatio: number | null
  carouselCount: number | null
  hasAudio: boolean | null
  videoDurationS: number | null
  isPaidPartnership: boolean | null
  repostCount: number | null
  usertagCount: number | null
  hasLocation: boolean
  // tempo
  weekday: string | null
  hour: number | null
}

export type HookType =
  | 'pergunta'
  | 'numero'
  | 'citacao'
  | 'grito'
  | 'contraste'
  | 'negacao'
  | 'condicional'
  | 'pessoal'
  | 'imperativo'
  | 'declaracao'
  | 'sem_legenda'
export type CtaType = 'salvar' | 'comentar' | 'compartilhar' | 'marcar' | 'seguir' | 'link' | 'nenhum'

const EMOJI_RE = /\p{Extended_Pictographic}/gu
const HASHTAG_RE = /#[\p{L}\p{N}_]+/gu
const MENTION_RE = /@[\p{L}\p{N}_.]+/gu
const LETTER_RE = /\p{L}/gu
const UPPER_RE = /\p{Lu}/gu

/** Ordem importa: o primeiro que casar vence, do mais especifico ao mais generico. */
const CTA_RULES: [CtaType, string[]][] = [
  ['link', ['link na bio', 'linkinbio', 'link in bio', 'clique no link', 'acesse o link', 'arrasta pra cima']],
  ['salvar', ['salva esse', 'salva este', 'salve esse', 'salva aí', 'salva ai', 'guarda esse', 'save this']],
  ['marcar', ['marca um', 'marca alguém', 'marca alguem', 'marque alguém', 'marca aquele', 'tag someone']],
  ['compartilhar', ['compartilha', 'manda pra', 'envia pra', 'manda para', 'share this']],
  ['comentar', ['comenta aí', 'comenta ai', 'comenta abaixo', 'me conta', 'deixa seu comentário', 'comment below']],
  ['seguir', ['me segue', 'segue lá', 'segue la', 'siga @', 'follow for more', 'siga para mais']],
]

const IMPERATIVOS = [
  'pare', 'para de', 'olha', 'olhe', 'veja', 'vê', 'imagina', 'imagine', 'esquece', 'esqueça',
  'sempre', 'comece', 'comeca', 'aprenda', 'descubra', 'entenda', 'lembre', 'evite',
  'faça', 'faca', 'pense', 'anota', 'presta atenção', 'presta atencao',
]

/** "parece X, mas e Y" — estrutura de virada, muito comum no nicho */
const CONTRASTE = [' mas ', ' porém ', ' porem ', ' e sim ', 'em vez de', 'ao invés de', 'ao inves de', ' só que ']

/** negar uma crença comum é um hook por si só */
const NEGACAO = ['não ', 'nao ', 'nunca ', 'nenhum', 'ninguém ', 'ninguem ', 'jamais ']

const CONDICIONAL = ['se voce', 'se você', 'se vc', 'quando voce', 'quando você', 'caso voce', 'caso você']

const PESSOAL = ['eu ', 'meu ', 'minha ', 'no meu ', 'quando eu ', 'comigo ', 'na minha ']

function countMatches(text: string, re: RegExp): number {
  return (text.match(re) ?? []).length
}

function detectHook(firstLine: string): HookType {
  const line = firstLine.trim()
  if (line === '') return 'sem_legenda'
  if (line.includes('?')) return 'pergunta'
  if (/^["'“”«]/.test(line)) return 'citacao'
  if (/^\d/.test(line)) return 'numero'

  const letters = countMatches(line, LETTER_RE)
  const uppers = countMatches(line, UPPER_RE)
  if (letters >= 8 && uppers / letters > 0.7) return 'grito'

  const lower = line.toLowerCase()

  if (CONTRASTE.some((needle) => lower.includes(needle))) return 'contraste'
  if (NEGACAO.some((needle) => lower.includes(needle))) return 'negacao'
  if (CONDICIONAL.some((needle) => lower.startsWith(needle))) return 'condicional'
  if (PESSOAL.some((needle) => lower.startsWith(needle))) return 'pessoal'
  if (IMPERATIVOS.some((verb) => lower.startsWith(verb))) return 'imperativo'

  return 'declaracao'
}

function detectCta(caption: string): CtaType {
  const lower = caption.toLowerCase()
  for (const [type, needles] of CTA_RULES) {
    if (needles.some((needle) => lower.includes(needle))) return type
  }
  return 'nenhum'
}

function aspectOf(width: number | null, height: number | null): {
  aspect: PostFeatures['aspect']
  aspectRatio: number | null
} {
  if (!width || !height) return { aspect: 'desconhecido', aspectRatio: null }
  const ratio = width / height
  if (ratio < 0.95) return { aspect: 'vertical', aspectRatio: ratio }
  if (ratio > 1.05) return { aspect: 'horizontal', aspectRatio: ratio }
  return { aspect: 'quadrado', aspectRatio: ratio }
}

function weekdayOf(date: Date | null): string | null {
  if (!date) return null
  return new Intl.DateTimeFormat('pt-BR', { timeZone: config.TZ_NAME, weekday: 'short' })
    .format(date)
    .replace('.', '')
}

function hourOf(date: Date | null): number | null {
  if (!date) return null
  return Number(
    new Intl.DateTimeFormat('en-US', { timeZone: config.TZ_NAME, hour: 'numeric', hour12: false }).format(date),
  )
}

export interface FeatureInput {
  caption?: string | null
  takenAt?: Date | null
  originalWidth?: number | null
  originalHeight?: number | null
  carouselCount?: number | null
  hasAudio?: boolean | null
  videoDurationS?: number | null
  isPaidPartnership?: boolean | null
  repostCount?: number | null
  usertagCount?: number | null
  locationName?: string | null
}

/**
 * Features deterministicas: nenhuma chamada de modelo, nenhum custo.
 * Cobre boa parte do que interessa para ranquear — hook, CTA, formato,
 * horario — e fica disponivel no instante em que o post e parseado.
 */
export function extractFeatures(input: FeatureInput): PostFeatures {
  const caption = input.caption ?? ''
  const lines = caption.split('\n').map((l) => l.trim())
  const firstLine = lines.find((l) => l !== '') ?? ''

  const letters = countMatches(caption, LETTER_RE)
  const uppers = countMatches(caption, UPPER_RE)
  const { aspect, aspectRatio } = aspectOf(input.originalWidth ?? null, input.originalHeight ?? null)

  return {
    captionLength: caption.length,
    lineCount: lines.filter((l) => l !== '').length,
    firstLine,
    hashtagCount: countMatches(caption, HASHTAG_RE),
    mentionCount: countMatches(caption, MENTION_RE),
    emojiCount: countMatches(caption, EMOJI_RE),
    upperRatio: letters > 0 ? Number((uppers / letters).toFixed(3)) : 0,
    hasQuestion: caption.includes('?'),
    hookType: detectHook(firstLine),
    ctaType: caption === '' ? 'nenhum' : detectCta(caption),
    aspect,
    aspectRatio: aspectRatio === null ? null : Number(aspectRatio.toFixed(3)),
    carouselCount: input.carouselCount ?? null,
    hasAudio: input.hasAudio ?? null,
    videoDurationS: input.videoDurationS ?? null,
    isPaidPartnership: input.isPaidPartnership ?? null,
    repostCount: input.repostCount ?? null,
    usertagCount: input.usertagCount ?? null,
    hasLocation: Boolean(input.locationName),
    weekday: weekdayOf(input.takenAt ?? null),
    hour: hourOf(input.takenAt ?? null),
  }
}
