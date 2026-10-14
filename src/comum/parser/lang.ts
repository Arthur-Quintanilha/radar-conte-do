/**
 * Idioma da legenda por contagem de palavras-funcao. Sem dependencia e sem
 * modelo: serve so para separar o que e do Brasil do que a busca traz de
 * fora ("software house" puxa India, Indonesia, Alemanha...).
 */
export type Lang = 'pt' | 'en' | 'es' | 'id' | 'outro' | 'indefinido'

const PALAVRAS: Record<Exclude<Lang, 'outro' | 'indefinido'>, string[]> = {
  pt: ['você', 'voce', 'não', 'nao', 'é', 'são', 'está', 'para', 'pra', 'com', 'uma', 'um', 'que', 'do', 'da', 'dos', 'das', 'no', 'na', 'nos', 'em', 'mais', 'seu', 'sua', 'como', 'isso', 'esse', 'essa', 'também', 'quem', 'já', 'ou', 'mas', 'sem', 'aqui', 'empresa', 'sistema', 'seus', 'suas', 'ao', 'pelo', 'pela', 'vocês', 'nós', 'meu', 'minha', 'ainda', 'sobre', 'tudo', 'agora', 'quando', 'porque', 'fazer', 'tem', 'ter', 'seu', 'desenvolvemos', 'criar'],
  en: ['the', 'and', 'you', 'your', 'is', 'are', 'to', 'of', 'for', 'with', 'this', 'that', 'my', 'it', 'on', 'in', 'what', 'how', 'we', 'our', 'be', 'can', 'just', 'from', 'about', 'not', 'will', 'i'],
  es: ['el', 'los', 'las', 'y', 'es', 'con', 'por', 'del', 'también', 'está', 'tu', 'su', 'pero', 'muy', 'lo', 'al', 'hay', 'qué', 'cómo', 'eres', 'somos', 'tienes'],
  id: ['yang', 'dan', 'di', 'untuk', 'ini', 'dengan', 'kamu', 'kami', 'aku', 'tidak', 'ada', 'itu', 'bisa', 'dari', 'akan', 'juga', 'sudah', 'atau'],
}

const INDICE = new Map<string, Array<keyof typeof PALAVRAS>>()
for (const [lang, palavras] of Object.entries(PALAVRAS) as Array<[keyof typeof PALAVRAS, string[]]>) {
  for (const p of palavras) INDICE.set(p, [...(INDICE.get(p) ?? []), lang])
}

export function detectLang(texto: string | null | undefined): Lang {
  if (!texto) return 'indefinido'
  const limpo = texto
    .toLowerCase()
    .replace(/[#@][\p{L}\p{N}_.]+/gu, ' ') // hashtags e mencoes nao dizem o idioma
    .replace(/https?:\/\/\S+/g, ' ')
  const palavras = limpo.match(/\p{L}+/gu) ?? []
  if (palavras.length < 3) return 'indefinido'

  const pontos = { pt: 0, en: 0, es: 0, id: 0 }
  for (const p of palavras) {
    const langs = INDICE.get(p)
    if (langs) for (const l of langs) pontos[l] += 1 / langs.length
  }
  // grafia que so o portugues usa
  pontos.pt += (limpo.match(/ção|ções|ão\b|ões\b|[ãõ]/g) ?? []).length * 0.7
  pontos.es += (limpo.match(/ñ|ción\b|[¿¡]/g) ?? []).length * 0.7

  const [melhor, valor] = Object.entries(pontos).sort((a, b) => b[1] - a[1])[0] ?? ['outro', 0]
  if (valor < 1.5) return palavras.length >= 8 ? 'outro' : 'indefinido'
  return melhor as Lang
}
