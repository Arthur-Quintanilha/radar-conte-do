import { z } from 'zod'

/**
 * Entrevista curta de territorio: cinco perguntas, so as duas primeiras
 * obrigatorias. Quem responde e o proprio creator. `fora` e a unica que a IA
 * nunca reescreve: vai direto para o territorio.
 */
export const PERGUNTAS = [
  { chave: 'quem_e', pergunta: 'Quem é você? O que faz hoje, em poucas linhas.' },
  { chave: 'publico', pergunta: 'Quem você quer que te assista?' },
  { chave: 'assuntos', pergunta: 'Sobre o que você gosta de falar? Assuntos, opiniões, histórias que sempre conta.' },
  { chave: 'pessoal', pergunta: 'O que você faz fora do trabalho e topa mostrar? (esporte, hobby, família...)' },
  { chave: 'fora', pergunta: 'Algum tema que fica de fora? Um por linha.' },
] as const

export type ChavePergunta = (typeof PERGUNTAS)[number]['chave']

export const temaTerritorio = z.object({
  tema: z.string().min(1).max(80),
  /** o que o creator tem a dizer: historia, opiniao ou experiencia, citando a entrevista */
  detalhe: z.string().max(400).optional().default(''),
})

export const territorio = z.object({
  resumo: z.string().max(800).optional().default(''),
  publico: z.string().max(600).optional().default(''),
  /** temas profissionais em que ele tem o que dizer */
  temas: z.array(temaTerritorio).max(20).default([]),
  /** lado pessoal que ele topa mostrar: e dai que vem a aproximacao */
  pessoal: z.array(temaTerritorio).max(15).default([]),
  opinioes: z.array(z.string().max(300)).max(10).default([]),
  historias: z.array(z.string().max(400)).max(10).default([]),
  tom: z.string().max(300).optional().default(''),
  formatos: z.array(z.string().max(60)).max(8).default([]),
  /** preenchido so pelo creator */
  fora: z.array(z.string().max(120)).max(30).default([]),
})
export type Territorio = z.infer<typeof territorio>

// a LLM as vezes escreve com acento ou maiuscula
export function normalizar(v: unknown): unknown {
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

const booleano = z.preprocess((v) => {
  if (typeof v === 'boolean') return v
  const t = normalizar(v)
  if (t === 'sim' || t === 'true' || t === 's' || t === 'yes') return true
  if (t === 'nao' || t === 'false' || t === 'n' || t === 'no') return false
  return v
}, z.boolean())

export const PAPEIS = ['consumido', 'par', 'fora'] as const
export type Papel = (typeof PAPEIS)[number]

export const contaAnswer = z.object({
  id: z.string().min(1),
  papel: z.preprocess(normalizar, z.enum(PAPEIS)),
  confianca,
  motivo: z.string().min(1).max(600),
  tema: z.string().max(80).optional().default(''),
  candidata_semente: booleano.optional().default(false),
  candidata_referencia: booleano.optional().default(false),
})
export type ContaAnswer = z.infer<typeof contaAnswer>

export const ENCAIXES = ['dentro', 'radar', 'fora'] as const
export type Encaixe = (typeof ENCAIXES)[number]

export const encaixeAnswer = z.object({
  id: z.string().min(1),
  encaixe: z.preprocess(normalizar, z.enum(ENCAIXES)),
  tema: z.string().max(120).optional().default(''),
  tema_territorio: z.string().max(120).optional().nullable().default(''),
  angulo: z.string().max(600).optional().nullable().default(''),
  radar_tema: z.string().max(60).optional().nullable().default(''),
  confianca,
  motivo: z.string().min(1).max(600),
})
export type EncaixeAnswer = z.infer<typeof encaixeAnswer>

export const FORMATOS = ['reels_fala', 'reels_bastidor', 'carrossel', 'foto_legenda', 'stories'] as const

export const ideiaAnswer = z.object({
  post_id: z.string().min(1),
  titulo: z.string().min(1).max(160),
  por_que: z.string().max(600).optional().default(''),
  angulo: z.string().min(1).max(800),
  hook: z.string().max(300).optional().default(''),
  formato: z.string().max(120).optional().default(''),
  /** qual dos "formatos que o publico consome" (F1, F2...) embala a ideia */
  formato_ref: z.string().max(10).optional().nullable(),
})
export type IdeiaAnswer = z.infer<typeof ideiaAnswer>

export const MOTIVOS_RECUSA = {
  tema: 'Não é meu tema',
  tom: 'Não é meu tom',
  ja_falei: 'Já falei disso',
  ruim: 'Ideia fraca',
} as const
export type MotivoRecusa = keyof typeof MOTIVOS_RECUSA

// a IA as vezes passa do tamanho, manda numero ou manda objeto: corta e converte em vez de recusar o roteiro inteiro
const paraTexto = (v: unknown): string => {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) return v.map(paraTexto).filter(Boolean).join('\n')
  if (typeof v === 'object') return Object.entries(v as Record<string, unknown>).map(([k, x]) => `${k}: ${paraTexto(x)}`).join('\n')
  return String(v)
}
const texto = (max: number) => z.preprocess((v) => paraTexto(v).trim().slice(0, max), z.string())
const lista = (max: number, maxItens: number) =>
  z.preprocess((v) => (Array.isArray(v) ? v : v === null || v === undefined || v === '' ? [] : [v]).map((x) => paraTexto(x).trim().slice(0, max)).filter(Boolean).slice(0, maxItens), z.array(z.string()))

const gancho = z.preprocess(
  (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : { texto: v }),
  z.object({ texto: texto(400), entonacao: texto(200).optional().default('') }),
)

/**
 * Roteiro centrado na FALA: o que dizer, como dizer (entonacao, pausas,
 * enfase) e o audio. Cenario e enquadramento ficam com o creator; "acao" so
 * existe quando o formato exige (andar, gesto da trend, mostrar algo).
 * Aceita o formato antigo (ganchos como texto, "visual" no bloco).
 */
export const roteiroAnswer = z.object({
  /** o esqueleto do post de referencia que o roteiro copia */
  molde: texto(4000).optional().default(''),
  /** @ do post cujo formato foi copiado (gravado pelo sistema) */
  formato_de: texto(60).optional().default(''),
  formato: texto(300).optional().default(''),
  /** sugestao rapida de como gravar: enquadramento, camera, olhar, cortes. Sem cenario */
  gravacao: texto(600).optional().default(''),
  duracao_s: z.preprocess((v) => {
    if (v === '' || v === null || v === undefined) return null
    const n = typeof v === 'string' ? Number(v.replace(',', '.').replace(/[^\d.]/g, '')) : Number(v)
    return Number.isFinite(n) && n > 0 && n <= 3600 ? n : null
  }, z.number().nullable()).optional().default(null),
  audio: z
    .preprocess(
      (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : v ? { nome: v } : {}),
      z.object({ tipo: texto(40).optional().default(''), nome: texto(200).optional().default(''), nota: texto(500).optional().default('') }),
    )
    .optional()
    .default({ tipo: '', nome: '', nota: '' }),
  ganchos: z
    .preprocess((v) => (Array.isArray(v) ? v : v === null || v === undefined || v === '' ? [] : [v]), z.array(gancho))
    .transform((xs) => xs.filter((g) => g.texto.trim()).slice(0, 5))
    .pipe(z.array(z.object({ texto: z.string(), entonacao: z.string() })).min(1)),
  /** a fala inteira, corrida, um paragrafo por ideia: e o roteiro */
  fala: texto(8000).optional().default(''),
  /** como falar o video inteiro, numa frase */
  tom: texto(400).optional().default(''),
  /** textos escritos que aparecem no video, um por item */
  tela: lista(300, 15).optional().default([]),
  blocos: z
    .array(
      z.preprocess(
        (v) => {
          const b = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
          return { ...b, acao: b['acao'] ?? b['visual'] }
        },
        z.object({
          parte: texto(120).optional().default(''),
          tempo: texto(60).optional().default(''),
          fala: texto(3000).optional().default(''),
          entonacao: texto(300).optional().default(''),
          tela: texto(1200).optional().default(''),
          acao: texto(800).optional().default(''),
        }),
      ),
    )
    .optional()
    .default([])
    .transform((xs) => xs.slice(0, 40)),
  legenda: texto(2200).optional().default(''),
  cta: texto(500).optional().default(''),
  lembretes: lista(500, 12).optional().default([]),
}).transform((r) => ({
  ...r,
  // roteiros antigos vinham em cenas: a fala corrida e a soma delas
  fala: r.fala || r.blocos.map((b) => b.fala.trim()).filter(Boolean).join('\n\n'),
  tela: r.tela.length ? r.tela : r.blocos.map((b) => b.tela.trim()).filter(Boolean),
})).refine((r) => r.fala.trim().length > 0, { message: 'sem fala', path: ['fala'] })
export type RoteiroAnswer = z.infer<typeof roteiroAnswer>
