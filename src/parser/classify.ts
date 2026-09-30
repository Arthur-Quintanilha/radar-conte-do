/**
 * Classificacao SEM IA, por palavras-chave. E um primeiro filtro barato: sugere
 * o que o perfil provavelmente e e quao relevante um post e para a KXP. Erra,
 * e por isso so sugere; quem decide o que acompanhar e voce, no painel. Os
 * criterios completos (que a LLM vai usar) estao em docs/criterios.md.
 */

export type AuthorClass = 'concorrente' | 'referencia' | 'publico' | 'fora' | 'indefinido'
export type Relevance = 'alta' | 'media' | 'baixa'

export interface Suggestion<T> {
  valor: T
  /** palavras que decidiram, para voce conferir */
  motivos: string[]
}

/** minusculo e sem acento, para casar "fábrica" com "fabrica" */
export function fold(text: string | null | undefined): string {
  return (text ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
}

type Regras = Record<string, number>

// quem vende desenvolvimento de software para empresas: o que a KXP e
const CONCORRENTE: Regras = {
  'software house': 3,
  'fabrica de software': 3,
  'desenvolvimento de software': 2,
  'software sob medida': 3,
  'sob medida': 1.5,
  'desenvolvemos': 2,
  'desenvolvimento de sistemas': 2,
  'desenvolvimento de aplicativos': 2,
  'aplicativos para empresas': 2,
  'sistemas para empresas': 2,
  'outsourcing': 2,
  'squad': 1.5,
  'squads': 1.5,
  'alocacao de': 1.5,
  'body shop': 2,
  'consultoria de ti': 2,
  'solucoes em tecnologia': 1.5,
  'solucoes digitais': 1.5,
  'transformacao digital': 1,
  'product studio': 2.5,
  'software development company': 3,
  'software development': 1.5,
  'digital agency': 1.5,
  'tirar sua ideia do papel': 2,
  'seu projeto': 1,
  'orcamento': 1,
  'fale com um consultor': 1.5,
  'mvp': 1,
  // categorias que a propria conta escolhe no Instagram
  'empresa de software': 3,
  'software company': 3,
  'servicos de ti': 2,
  'servico de ti': 2,
  'consultor de ti': 1.5,
}

// lideranca e produto: gente que fala com quem compra
const REFERENCIA: Regras = {
  cto: 3,
  ceo: 1.5,
  coo: 2,
  'head of': 2,
  'diretor de tecnologia': 3,
  'vp de engenharia': 3,
  'vp of engineering': 3,
  'engineering manager': 2,
  'gestao de times': 2,
  lideranca: 0.75,
  'product manager': 3,
  'gerente de produto': 3,
  'product owner': 2,
  'gestao de produto': 3,
  'product management': 3,
  'product discovery': 2.5,
  founder: 1.5,
  fundador: 1.5,
  'co-founder': 1.5,
  cofundador: 1.5,
  investidor: 1,
  startups: 0.5,
}

// conteudo para dev iniciante e carreira: audiencia, nao comprador
const PUBLICO: Regras = {
  programador: 2,
  programadora: 2,
  programacao: 2,
  'aprenda a programar': 3,
  'estudar programacao': 3,
  'carreira em ti': 2,
  'carreira dev': 2,
  'primeiro emprego': 2,
  junior: 1.5,
  'dev junior': 2,
  estudante: 1.5,
  faculdade: 1,
  curso: 1,
  cursos: 1,
  mentoria: 1,
  vscode: 2,
  'logica de programacao': 3,
  python: 1,
  javascript: 1,
  frontend: 1,
  backend: 1,
  meme: 1.5,
  memes: 1.5,
}

function pontuar(texto: string, regras: Regras): { pontos: number; achou: string[] } {
  let pontos = 0
  const achou: string[] = []
  for (const [chave, peso] of Object.entries(regras)) {
    // palavra inteira: "cto" nao casa com "projecto"
    const re = new RegExp(`(^|[^a-z0-9])${chave.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`)
    if (re.test(texto)) {
      pontos += peso
      achou.push(chave)
    }
  }
  return { pontos, achou }
}

export interface AuthorInput {
  username: string
  fullName?: string | null
  biography?: string | null
  /** categoria escolhida pela conta no Instagram */
  category?: string | null
  /** legendas dos posts dele que temos no banco */
  captions?: (string | null)[]
}

/**
 * Nome e bio pesam o dobro: dizem o que o perfil E. Legendas dizem do que ele
 * fala, e um concorrente tambem posta sobre carreira de vez em quando.
 */
export function suggestAuthorClass(a: AuthorInput): Suggestion<AuthorClass> {
  const perfil = fold(`${a.username.replace(/[._]/g, ' ')} ${a.fullName ?? ''} ${a.biography ?? ''} ${a.category ?? ''}`)
  const legendas = fold((a.captions ?? []).filter(Boolean).slice(0, 20).join('\n'))
  const nPosts = Math.max(1, (a.captions ?? []).filter(Boolean).length)

  const placar = (regras: Regras) => {
    const p = pontuar(perfil, regras)
    const l = pontuar(legendas, regras)
    // legenda normalizada pelo numero de posts, com teto: um perfil com 20
    // posts nao pode ganhar so por volume
    return { pontos: p.pontos * 2 + Math.min(4, (l.pontos / nPosts) * 1.5 + (l.pontos > 0 ? 0.5 : 0)), achou: [...new Set([...p.achou, ...l.achou])] }
  }

  const c = placar(CONCORRENTE)
  const r = placar(REFERENCIA)
  const p = placar(PUBLICO)

  const ranking: [AuthorClass, { pontos: number; achou: string[] }][] = [
    ['concorrente', c],
    ['referencia', r],
    ['publico', p],
  ]
  ranking.sort((x, y) => y[1].pontos - x[1].pontos)
  const [classe, melhor] = ranking[0] ?? ['indefinido', { pontos: 0, achou: [] }]

  if (melhor.pontos < 2) {
    return { valor: legendas.length > 0 || perfil.trim().length > 0 ? 'fora' : 'indefinido', motivos: melhor.achou }
  }
  return { valor: classe, motivos: melhor.achou.slice(0, 6) }
}

// assuntos que interessam a quem compra software: gestor, founder, empresa
const RELEVANTE: Regras = {
  ...CONCORRENTE,
  empresa: 1,
  empresas: 1,
  empresario: 2,
  empreendedor: 1.5,
  gestor: 2,
  gestores: 2,
  cto: 2,
  'product manager': 2,
  'gestao de produto': 2,
  produto: 1,
  'produto digital': 2,
  startup: 1.5,
  founder: 1.5,
  'validar ideia': 2.5,
  validacao: 1.5,
  'sistema legado': 2.5,
  legado: 1.5,
  automacao: 1.5,
  'automacao de processos': 2,
  'ia para empresas': 2.5,
  'inteligencia artificial': 1,
  processos: 1,
  custo: 1,
  prazo: 1,
  roi: 1.5,
  escalar: 1,
  eficiencia: 1,
  contratar: 1,
  terceirizar: 2,
}

/**
 * Relevancia do post para a KXP: fala com quem compra software (alta), toca
 * no assunto (media) ou e conteudo para dev/entretenimento (baixa).
 */
export function suggestRelevance(caption: string | null | undefined, transcript?: string | null): Suggestion<Relevance> {
  const texto = fold(`${caption ?? ''}\n${transcript ?? ''}`)
  const bom = pontuar(texto, RELEVANTE)
  const dev = pontuar(texto, PUBLICO)
  const saldo = bom.pontos - dev.pontos * 0.7

  if (saldo >= 4) return { valor: 'alta', motivos: bom.achou.slice(0, 6) }
  if (saldo >= 1.5) return { valor: 'media', motivos: bom.achou.slice(0, 6) }
  return { valor: 'baixa', motivos: dev.achou.length ? dev.achou.slice(0, 6) : bom.achou.slice(0, 6) }
}
