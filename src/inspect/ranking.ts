import { sql } from 'drizzle-orm'
import { db } from '../db/client'
import { printRows } from './db'
import { detectLang, type Lang } from '../parser/lang'

interface PostRow {
  shortcode: string
  username: string | null
  followers: number | null
  likes: number | null
  comments: number | null
  termos: string
  melhor_posicao: number | null
  caption: string | null
}

interface AuthorRow {
  username: string
  full_name: string | null
  followers: number | null
  posts: number
  termos: number
  lista_termos: string
  curtidas_total: number
  comentarios_total: number
  melhor_posicao: number | null
}

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 10_000) return `${Math.round(n / 1_000)}k`
  return String(n)
}

/** curtidas + comentarios pesando o dobro: comentar custa mais que curtir */
function engajamento(likes: number | null, comments: number | null): number {
  return (likes ?? 0) + 2 * (comments ?? 0)
}

export interface RankingOptions {
  termo?: string
  limite?: number
  /** 'todos' (padrao) nao filtra; 'pt' mantem portugues e legendas curtas demais para dizer */
  idioma?: string
}

function aceitaIdioma(lang: Lang, idioma: string): boolean {
  if (idioma === 'todos') return true
  if (idioma === 'pt') return lang === 'pt' || lang === 'indefinido'
  return lang === idioma
}

/**
 * Ranking do que apareceu nas buscas: posts por engajamento e autores por
 * presenca em varios termos. E a lista de candidatos que depois a LLM
 * classifica em concorrente, referencia, publico ou fora (docs/criterios.md).
 */
export async function printRanking(options: RankingOptions = {}): Promise<void> {
  const limite = options.limite ?? 25
  const filtroTermo = options.termo ? sql`and d.term = ${options.termo.trim().toLowerCase()}` : sql``

  const posts = db.all<PostRow>(sql`
    select p.shortcode, a.username, a.followers_count as followers,
      (select m.like_count from post_metric m where m.post_id = p.id order by m.captured_at desc limit 1) as likes,
      (select m.comment_count from post_metric m where m.post_id = p.id order by m.captured_at desc limit 1) as comments,
      group_concat(distinct d.term) as termos,
      min(d.position) as melhor_posicao,
      p.caption
    from discovery d
    join post p on p.id = d.post_id
    left join author a on a.id = p.author_id
    where d.source = 'search' ${filtroTermo}
    group by p.id
  `)

  if (posts.length === 0) {
    console.log('\n  Nenhum post de busca ainda. Rode `npm run busca` e depois `npm run parse`.\n')
    return
  }

  const idioma = options.idioma ?? 'todos'
  const comIdioma = posts.map((p) => ({ ...p, lang: detectLang(p.caption) }))
  const filtrados = comIdioma.filter((p) => aceitaIdioma(p.lang, idioma))
  const foraDoIdioma = comIdioma.length - filtrados.length

  // idioma de cada autor = o mais comum nos posts dele
  const votos = new Map<string, Map<Lang, number>>()
  for (const p of comIdioma) {
    if (!p.username || p.lang === 'indefinido') continue
    const v = votos.get(p.username) ?? new Map<Lang, number>()
    v.set(p.lang, (v.get(p.lang) ?? 0) + 1)
    votos.set(p.username, v)
  }
  const idiomaDoAutor = (u: string): Lang => {
    const v = votos.get(u)
    if (!v) return 'indefinido'
    return [...v.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'indefinido'
  }

  const topPosts = filtrados
    .map((p) => {
      const eng = engajamento(p.likes, p.comments)
      return { ...p, eng, taxa: p.followers ? eng / p.followers : null }
    })
    .sort((a, b) => b.eng - a.eng)
    .slice(0, limite)

  const nota = idioma === 'todos' ? '' : `, ${foraDoIdioma} de outro idioma escondidos`
  console.log(`\n  POSTS DA BUSCA POR ENGAJAMENTO${options.termo ? ` — "${options.termo}"` : ''}  (${filtrados.length} de ${posts.length}${nota})\n`)
  printRows(
    topPosts.map((p) => ({
      '@': p.username ?? '—',
      lng: p.lang === 'indefinido' ? '?' : p.lang,
      curtidas: fmt(p.likes),
      coment: fmt(p.comments),
      seguidores: fmt(p.followers),
      'eng/seg': p.taxa === null ? '—' : `${(p.taxa * 100).toFixed(1)}%`,
      pos: p.melhor_posicao ?? '—',
      termos: p.termos,
      legenda: p.caption ?? '',
      link: `instagram.com/p/${p.shortcode}`,
    })),
    40,
  )

  const autores = db.all<AuthorRow>(sql`
    select a.username, a.full_name, a.followers_count as followers,
      count(distinct p.id) as posts,
      count(distinct d.term) as termos,
      group_concat(distinct d.term) as lista_termos,
      coalesce(sum(m.like_count), 0) as curtidas_total,
      coalesce(sum(m.comment_count), 0) as comentarios_total,
      min(d.position) as melhor_posicao
    from discovery d
    join post p on p.id = d.post_id
    join author a on a.id = p.author_id
    left join post_metric m on m.id = (
      select m2.id from post_metric m2 where m2.post_id = p.id order by m2.captured_at desc limit 1
    )
    where d.source = 'search' ${filtroTermo}
    group by a.id
  `)

  // aparecer em varios termos diz mais sobre o assunto do perfil do que um viral isolado
  const autoresNoIdioma = autores.filter((a) => aceitaIdioma(idiomaDoAutor(a.username), idioma))
  const topAutores = autoresNoIdioma
    .map((a) => ({
      ...a,
      score: a.termos * 2 + Math.log10(1 + engajamento(a.curtidas_total, a.comentarios_total)),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limite)

  console.log(`\n  AUTORES QUE MAIS APARECEM  (${autoresNoIdioma.length} de ${autores.length})\n`)
  printRows(
    topAutores.map((a) => ({
      '@': a.username,
      nome: a.full_name ?? '',
      seguidores: fmt(a.followers),
      posts: a.posts,
      termos: a.termos,
      'curtidas (soma)': fmt(a.curtidas_total),
      pos: a.melhor_posicao ?? '—',
      quais: a.lista_termos,
    })),
    36,
  )

  if (idioma !== 'todos') console.log(`\n  Filtro de idioma: ${idioma}. Para ver tudo: npm run ranking`)
  const semSeguidores = autoresNoIdioma.filter((a) => a.followers === null).length
  if (semSeguidores > 0) {
    console.log(`\n  ${semSeguidores} autores ainda sem numero de seguidores; \`npm run authors\` preenche aos poucos.`)
  }
  console.log('')
}
