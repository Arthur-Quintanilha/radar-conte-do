import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { sql } from 'drizzle-orm'
import { db } from '../db/client'
import { CONTAS_VERSION, POSTS_VERSION, SELECAO_VERSION } from './schema'

export type Tipo = 'contas' | 'posts'

/**
 * Os criterios vem do docs/criterios.md (secoes "A KXP" ate "Relevancia do
 * post"): mudar o arquivo muda o prompt, sem mexer em codigo.
 */
export function loadCriterios(path = resolve(process.cwd(), 'docs', 'criterios.md')): string {
  if (!existsSync(path)) throw new Error(`nao achei ${path}: e ele que define os criterios do prompt`)
  const md = readFileSync(path, 'utf8')
  const ini = md.indexOf('## A KXP')
  const fim = md.indexOf('## Como vira número')
  if (ini === -1) throw new Error('docs/criterios.md sem a secao "## A KXP"')
  return md.slice(ini, fim === -1 ? undefined : fim).trim()
}

const corta = (t: string | null | undefined, n: number): string => {
  const limpo = (t ?? '').replace(/\s+/g, ' ').trim()
  return limpo.length > n ? `${limpo.slice(0, n - 1)}…` : limpo
}

/* ---------------------------------------------------------------- contas */

interface ContaRow {
  id: string
  username: string
  fullName: string | null
  category: string | null
  biography: string | null
  followers: number | null
  watch: string | null
  termos: string | null
  explore: number
  posts: number
}

export interface ContaItem {
  id: string
  nome: string | null
  categoria: string | null
  seguidores: number | null
  bio: string | null
  apareceu_em: string[]
  legendas_recentes: string[]
}

/**
 * Contas sem avaliacao da LLM nesta versao do prompt. Ignoradas ficam de fora.
 * Primeiro as que voce acompanha, depois as que aparecem em mais termos de busca.
 */
export function selectContas(limite: number, refazer = false): { rows: ContaRow[]; itens: ContaItem[] } {
  const rows = db.all<ContaRow>(sql`
    select a.id, a.username, a.full_name as fullName, a.category, a.biography, a.followers_count as followers, a.watch,
      (select group_concat(distinct d.term) from discovery d join post p on p.id = d.post_id
        where p.author_id = a.id and d.source = 'search') as termos,
      (select count(*) from discovery d join post p on p.id = d.post_id
        where p.author_id = a.id and d.source = 'explore') as explore,
      (select count(*) from post p where p.author_id = a.id) as posts
    from author a
    where coalesce(a.watch, '') <> 'ignorar'
      and exists (select 1 from post p where p.author_id = a.id)
      ${refazer ? sql`` : sql`and not exists (select 1 from classification c where c.target_type = 'author'
        and c.target_id = a.id and c.source = 'llm' and c.prompt_version = ${CONTAS_VERSION})`}
    order by (a.watch = 'acompanhar') desc,
      (select count(distinct d.term) from discovery d join post p on p.id = d.post_id where p.author_id = a.id and d.source = 'search') desc,
      posts desc
    limit ${limite}
  `)

  const itens = rows.map((r) => {
    const legendas = db
      .all<{ caption: string | null }>(sql`
        select caption from post where author_id = ${r.id} and caption is not null and caption <> ''
        order by taken_at desc limit 6
      `)
      .map((x) => corta(x.caption, 280))
    const onde = (r.termos ?? '').split(',').filter(Boolean).map((t) => `busca "${t}"`)
    if (r.explore > 0) onde.unshift('Explorar')
    return {
      id: `@${r.username}`,
      nome: r.fullName,
      categoria: r.category,
      seguidores: r.followers,
      bio: r.biography ? corta(r.biography, 400) : null,
      apareceu_em: onde,
      legendas_recentes: legendas,
    }
  })
  return { rows, itens }
}

/* ---------------------------------------------------------------- posts */

interface PostRow {
  id: string
  shortcode: string
  mediaType: string | null
  caption: string | null
  takenAt: number | null
  username: string | null
  category: string | null
  biography: string | null
  likes: number | null
  comments: number | null
  termos: string | null
  fala: string | null
  alt: string | null
}

export interface PostItem {
  id: string
  autor: string
  autor_categoria: string | null
  autor_bio: string | null
  tipo: string | null
  publicado: string | null
  curtidas: number | null
  comentarios: number | null
  apareceu_em: string[]
  legenda: string
  fala_do_video: string | null
  descricao_da_imagem: string | null
}

/**
 * Posts sem avaliacao da LLM. Primeiro os das contas que voce acompanha, depois
 * os achados na busca, depois o Explorar. Post sem nenhum texto (sem legenda,
 * fala ou descricao) fica de fora: nao ha o que avaliar.
 */
export function selectPosts(limite: number, refazer = false): { rows: PostRow[]; itens: PostItem[] } {
  const rows = db.all<PostRow>(sql`
    select p.id, p.shortcode, p.media_type as mediaType, p.caption, p.taken_at as takenAt,
      a.username, a.category, a.biography,
      (select m.like_count from post_metric m where m.post_id = p.id order by m.captured_at desc limit 1) as likes,
      (select m.comment_count from post_metric m where m.post_id = p.id order by m.captured_at desc limit 1) as comments,
      (select group_concat(distinct d.term) from discovery d where d.post_id = p.id and d.source = 'search') as termos,
      (select json_extract(e.output, '$.text') from enrichment e where e.post_id = p.id and e.kind = 'transcript'
        and json_extract(e.output, '$.text') <> '' order by e.model like 'whisper%' desc limit 1) as fala,
      (select json_extract(e.output, '$.text') from enrichment e where e.post_id = p.id and e.kind = 'alt_text' limit 1) as alt
    from post p
    left join author a on a.id = p.author_id
    where coalesce(a.watch, '') <> 'ignorar'
      and p.discovery_source in ('explore', 'search', 'profile')
      and (coalesce(p.caption, '') <> ''
        or exists (select 1 from enrichment e where e.post_id = p.id and e.kind in ('transcript', 'alt_text')
          and coalesce(json_extract(e.output, '$.text'), '') <> ''))
      ${refazer ? sql`` : sql`and not exists (select 1 from classification c where c.target_type = 'post'
        and c.target_id = p.id and c.source = 'llm' and c.prompt_version = ${POSTS_VERSION})`}
    order by (a.watch = 'acompanhar') desc,
      exists (select 1 from discovery d where d.post_id = p.id and d.source = 'search') desc,
      p.taken_at desc
    limit ${limite}
  `)

  const itens = rows.map((r) => {
    const onde = (r.termos ?? '').split(',').filter(Boolean).map((t) => `busca "${t}"`)
    return {
      id: r.shortcode,
      autor: `@${r.username ?? '?'}`,
      autor_categoria: r.category,
      autor_bio: r.biography ? corta(r.biography, 160) : null,
      tipo: r.mediaType,
      publicado: r.takenAt ? new Date(r.takenAt * 1000).toISOString().slice(0, 10) : null,
      curtidas: r.likes,
      comentarios: r.comments,
      apareceu_em: onde,
      legenda: corta(r.caption, 1200),
      fala_do_video: r.fala ? corta(r.fala, 900) : null,
      descricao_da_imagem: r.alt ? corta(r.alt, 240) : null,
    }
  })
  return { rows, itens }
}

/* ---------------------------------------------------------------- exemplos */

/** Suas correcoes mais recentes viram exemplo no prompt: ele aprende o seu julgamento. */
function correcoes(tipo: Tipo): string {
  if (tipo === 'contas') {
    const rows = db.all<{ username: string; classe: string }>(sql`
      select a.username, json_extract(c.output, '$.classe') as classe
      from classification c join author a on a.id = c.target_id
      where c.target_type = 'author' and c.source = 'humano'
      order by c.created_at desc limit 12
    `)
    return rows.map((r) => `- @${r.username} → ${r.classe}`).join('\n')
  }
  const rows = db.all<{ shortcode: string; relevancia: string; caption: string | null }>(sql`
    select p.shortcode, json_extract(c.output, '$.relevancia') as relevancia, p.caption
    from classification c join post p on p.id = c.target_id
    where c.target_type = 'post' and c.source = 'humano'
    order by c.created_at desc limit 8
  `)
  return rows.map((r) => `- "${corta(r.caption, 140)}" → ${r.relevancia}`).join('\n')
}

/* ---------------------------------------------------------------- prompt */

const FORMATO_CONTAS = `[
  {
    "id": "@usuario (copie exatamente o id recebido)",
    "classe": "concorrente | referencia_lideranca | referencia_produto | publico | fora",
    "confianca": 0.0,
    "motivo": "uma frase citando o que você viu na bio, categoria ou legendas",
    "sinais": ["trecho curto que sustenta a classe", "..."],
    "acompanhar": true
  }
]`

const FORMATO_POSTS = `[
  {
    "id": "SHORTCODE (copie exatamente o id recebido)",
    "relevancia": "alta | media | baixa",
    "publico": "comprador | dev | geral",
    "formato": "anuncio | educativo | opiniao | case | bastidor | noticia | meme | outro",
    "tema": "2 a 5 palavras",
    "angulo": "uma frase: o que a KXP poderia aproveitar deste post para o próprio conteúdo (vazio se a relevância for baixa)",
    "confianca": 0.0,
    "motivo": "uma frase citando o que você viu na legenda, na fala ou na imagem"
  }
]`

export function buildPrompt(tipo: Tipo, itens: (ContaItem | PostItem)[]): string {
  const criterios = loadCriterios()
  const exemplos = correcoes(tipo)
  const tarefa =
    tipo === 'contas'
      ? 'Classifique cada CONTA do Instagram abaixo em uma das classes de autor definidas nos critérios.'
      : 'Avalie cada POST do Instagram abaixo: a relevância para a KXP (julgue o post sozinho, não quem publicou), para quem ele fala e o que a KXP poderia aproveitar dele.'

  return `# Tarefa (radar-kxp · ${tipo} · prompt ${tipo === 'contas' ? CONTAS_VERSION : POSTS_VERSION})

Você está ajudando a KXP a mapear o Instagram: quem são os concorrentes, quem vale como referência e que conteúdo fala com quem compra software. ${tarefa}

## Critérios

${criterios}
${exemplos ? `\n## Correções que o time já fez (siga este julgamento)\n\n${exemplos}\n` : ''}
## Regras

- Use só o que está nos dados. Não invente cargo, cliente ou oferta que não aparece.
- Se os dados não bastam para decidir, escolha a classe mais provável e use confiança baixa (abaixo de 0.6).
- O motivo precisa citar a evidência (um trecho da bio, da categoria ou de uma legenda).
- Responda um objeto para CADA item recebido, com o mesmo "id".${tipo === 'posts' ? '\n- Primeiro decida o formato; anúncio fica no máximo em média. Alta exige substância que a KXP transformaria em post próprio, não só o tema certo.\n- Espere que a maioria dos posts seja média ou baixa. Use a escala de confiança inteira (veja "Confiança" nos critérios).' : ''}${tipo === 'contas' ? '\n- "acompanhar": true ou false, seguindo a seção "Quem acompanhar" dos critérios. É um filtro inicial: na dúvida, true (depois há uma rodada que escolhe as melhores).' : ''}

## Formato da resposta

Responda SOMENTE com um bloco de código \`\`\`json contendo esta lista, sem texto antes ou depois:

\`\`\`json
${tipo === 'contas' ? FORMATO_CONTAS : FORMATO_POSTS}
\`\`\`

## ${tipo === 'contas' ? 'Contas' : 'Posts'} (${itens.length})

\`\`\`json
${JSON.stringify(itens, null, 1)}
\`\`\`
`
}

/** Estimativa grosseira: ~4 caracteres por token em portugues. */
export const estimarTokens = (texto: string): number => Math.round(texto.length / 4)

/* ---------------------------------------------------------------- selecao */

interface CandRow {
  id: string
  username: string
  fullName: string | null
  category: string | null
  biography: string | null
  followers: number | null
  watch: string | null
  watchSource: string | null
  llm: string | null
  humano: string | null
  termos: string | null
  posts: number
  curtidas: number | null
  ultimo: number | null
}

export interface CandidataItem {
  id: string
  nome: string | null
  classe: string | null
  motivo_da_classe: string | null
  categoria: string | null
  seguidores: number | null
  bio: string | null
  apareceu_em: string[]
  posts_no_banco: number
  curtidas_media: number | null
  posts_relevantes: number
  ultimo_post: string | null
}

/**
 * Candidatas a acompanhar: contas que a LLM marcou "acompanhar: true" na
 * avaliacao, mais as que ja estao sendo acompanhadas pela IA (podem perder a
 * vaga). As que voce marcou ficam fixas; as que voce ignorou ou disse ser
 * "fora" nao entram.
 */
export function selectCandidatas(): { candidatas: CandidataItem[]; fixas: string[] } {
  const rows = db.all<CandRow>(sql`
    select a.id, a.username, a.full_name as fullName, a.category, a.biography, a.followers_count as followers,
      a.watch, a.watch_source as watchSource,
      (select output from classification c where c.target_type = 'author' and c.target_id = a.id and c.source = 'llm') as llm,
      (select json_extract(output, '$.classe') from classification c where c.target_type = 'author' and c.target_id = a.id and c.source = 'humano') as humano,
      (select group_concat(distinct d.term) from discovery d join post p on p.id = d.post_id where p.author_id = a.id and d.source = 'search') as termos,
      (select count(*) from post p where p.author_id = a.id) as posts,
      (select avg(m.like_count) from post p join post_metric m on m.post_id = p.id where p.author_id = a.id) as curtidas,
      (select max(p.taken_at) from post p where p.author_id = a.id) as ultimo
    from author a
    where coalesce(a.watch, '') <> 'ignorar'
      and (
        (a.watch = 'acompanhar')
        or exists (select 1 from classification c where c.target_type = 'author' and c.target_id = a.id
          and c.source = 'llm' and json_extract(c.output, '$.acompanhar') = 1)
      )
  `)

  const relevantes = new Map(
    db
      .all<{ author: string; n: number }>(sql`
        select p.author_id as author, count(*) as n from post p
        where exists (select 1 from classification c where c.target_type = 'post' and c.target_id = p.id
          and coalesce((select json_extract(h.output, '$.relevancia') from classification h
            where h.target_type = 'post' and h.target_id = p.id and h.source = 'humano'),
            json_extract(c.output, '$.relevancia')) in ('alta', 'media'))
        group by p.author_id
      `)
      .map((r) => [r.author, r.n]),
  )

  const fixas: string[] = []
  const candidatas: CandidataItem[] = []
  for (const r of rows) {
    if (r.watch === 'acompanhar' && r.watchSource !== 'ia') {
      fixas.push(`@${r.username}`)
      continue
    }
    const llm = r.llm ? (JSON.parse(r.llm) as Record<string, unknown>) : null
    const classe = r.humano ?? (typeof llm?.['classe'] === 'string' ? llm['classe'] : null)
    if (classe === 'fora') continue
    const onde = (r.termos ?? '').split(',').filter(Boolean).map((t) => `busca "${t}"`)
    candidatas.push({
      id: `@${r.username}`,
      nome: r.fullName,
      classe,
      motivo_da_classe: typeof llm?.['motivo'] === 'string' ? llm['motivo'] : null,
      categoria: r.category,
      seguidores: r.followers,
      bio: r.biography ? corta(r.biography, 200) : null,
      apareceu_em: onde,
      posts_no_banco: r.posts,
      curtidas_media: r.curtidas === null ? null : Math.round(r.curtidas),
      posts_relevantes: relevantes.get(r.id) ?? 0,
      ultimo_post: r.ultimo ? new Date(r.ultimo * 1000).toISOString().slice(0, 10) : null,
    })
  }
  return { candidatas, fixas }
}

export function buildSelecaoPrompt(vagas: number, candidatas: CandidataItem[], fixas: string[]): string {
  const criterios = loadCriterios()
  const n = Math.min(vagas, candidatas.length)
  return `# Tarefa (radar-kxp · selecao · prompt ${SELECAO_VERSION})

A KXP quer acompanhar de perto algumas contas do Instagram: um robô visita o perfil delas de tempos em tempos para ver o que postaram. Cada conta acompanhada custa visitas, então há vagas limitadas. Das ${candidatas.length} candidatas abaixo, escolha as ${n} que mais valem a pena acompanhar.

## Critérios

${criterios}

## Como escolher

- Prefira quem ajuda a KXP a entender o mercado e a fazer conteúdo: concorrentes diretos (mesma oferta e porte, e principalmente do Brasil e de Minas Gerais) e referências que postam sobre os temas de relevância alta e média.
- Prefira contas ativas (último post recente) e com posts relevantes no banco. Seguidores e curtidas ajudam a desempatar, mas não decidem sozinhos.
- Diversifique: não escolha só concorrentes, nem várias contas quase iguais.
- Use só o que está nos dados. O motivo precisa citar a evidência.
${fixas.length ? `- O time já acompanha estas contas (não repita e não conte nas vagas): ${fixas.join(', ')}.\n` : ''}
## Formato da resposta

Responda SOMENTE com um bloco de código \`\`\`json, sem texto antes ou depois, com exatamente ${n} contas em ordem de prioridade:

\`\`\`json
{
  "selecao": [
    { "id": "@usuario (copie exatamente)", "posicao": 1, "motivo": "uma frase: por que vale acompanhar" }
  ]
}
\`\`\`

## Candidatas (${candidatas.length})

\`\`\`json
${JSON.stringify(candidatas, null, 1)}
\`\`\`
`
}
