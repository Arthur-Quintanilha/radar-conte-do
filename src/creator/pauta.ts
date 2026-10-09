import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { ideia, roteiro } from '../db/schema'
import { extrairJson, extrairLista } from '../llm/json'
import { isoWeekOf } from '../shared/budget'
import { config } from '../shared/config'
import { localDayKey } from '../shared/time'
import { logger } from '../shared/logger'
import { corta, encaixesDe, historicoEngajamento, postsJanela, sementesPorAutor, territorioTexto, type PostJanela } from './dados'
import { perguntarLlm, modeloPauta, temApi } from './llm'
import { slidesDosPosts } from '../enricher/quadros'
import { exigirPersona, salvarTerritorio, territorioDe, type Persona } from './persona'
import { chaveTema, mediana, pontuar, pontuarPosts, type PostPontuado } from './score'
import { MOTIVOS_RECUSA, ideiaAnswer, type MotivoRecusa } from './tipos'
import type { Aplicacao, Montagem } from './tarefas'

/** Peso de alcance de um post de referencia de conteudo (o grafo vai de 0 a 1). */
export const ALCANCE_REFERENCIA = 0.5

/**
 * mais: acrescenta ideias novas a pauta da semana, sem mexer nas que existem
 * (o ciclo diario). refazer: troca as ideias ainda sem resposta.
 */
export type ModoPauta = 'mais' | 'refazer'

/** Semana ISO com dois digitos (2026-W05), para ordenar como texto. */
export function semanaDe(date = new Date()): string {
  const { week } = isoWeekOf(localDayKey(date))
  const [ano, w] = week.split('-W')
  return `${ano}-W${String(w).padStart(2, '0')}`
}

export interface Candidata extends PostPontuado {
  post: PostJanela
  tema: string | null
  temaTerritorio: string | null
  angulo: string | null
  radarTema: string | null
}

/**
 * Posts pontuados da persona. `dentro` alimenta a pauta, `radar` o rodape.
 * Post que ja virou ideia em outra semana nao volta.
 */
export async function pontuados(
  personaId: string,
  semana: string,
  opts: { modo?: ModoPauta } = {},
): Promise<{ dentro: Candidata[]; radar: Candidata[]; totalSementes: number }> {
  const posts = postsJanela(personaId)
  const enc = encaixesDe(personaId)
  const { total, mapa } = await sementesPorAutor(personaId)
  const hist = historicoEngajamento([...new Set(posts.map((p) => p.autor))])
  // fora: post que ja virou ideia em outra semana, ou que foi recusado nesta.
  // modo "mais" (o padrao do ciclo diario) tira todo post que ja tem ideia;
  // "refazer" tira tambem os da pauta atual ainda sem resposta
  const usados = new Set(
    db
      .all<{ id: string }>(sql`
        select post_id as id from ideia
        where persona_id = ${personaId} and tipo = 'pauta' and post_id is not null
          and (semana <> ${semana} or status = 'recusada'
            ${opts.modo === 'refazer' ? sql`or status = 'nova'` : opts.modo === 'mais' ? sql`or 1 = 1` : sql``})
      `)
      .map((r) => r.id),
  )
  const porId = new Map(posts.map((p) => [p.id, p]))
  const base = posts
    .filter((p) => enc.has(p.id))
    .map((p) => ({ postId: p.id, autor: p.autor, likes: p.likes, comments: p.comments, confianca: enc.get(p.id)?.confianca ?? null }))
  // referencia nao precisa ser seguida pelas sementes: ganha um alcance fixo,
  // para disputar com o grafo pelo desempenho e pela confianca
  const pont = pontuarPosts(base, hist, mapa, total)
    .map((x) => {
      if (porId.get(x.postId)?.origem !== 'referencia' || x.alcance >= ALCANCE_REFERENCIA) return x
      return { ...x, alcance: ALCANCE_REFERENCIA, score: pontuar({ alcance: ALCANCE_REFERENCIA, desempenho: x.desempenho, confianca: x.confianca }) }
    })
    .sort((a, b) => b.score - a.score)
  const dentro: Candidata[] = []
  const radar: Candidata[] = []
  for (const x of pont) {
    const e = enc.get(x.postId)
    const post = porId.get(x.postId)
    if (!e || !post) continue
    const c: Candidata = { ...x, post, tema: e.tema, temaTerritorio: e.temaTerritorio, angulo: e.angulo, radarTema: e.radarTema }
    if (e.encaixe === 'dentro' && !usados.has(x.postId)) dentro.push(c)
    else if (e.encaixe === 'radar' && e.radarTema) radar.push(c)
  }
  return { dentro, radar, totalSementes: total }
}

const vezes = (d: number) => `${d.toFixed(1).replace('.', ',')}x`

export function porQueDe(c: Candidata, total: number): string {
  const partes =
    c.post.origem === 'referencia'
      ? [`@${c.autor} é referência de conteúdo${c.sementes ? ` e ${c.sementes} de ${total} sementes seguem` : ''}`]
      : [`${c.sementes} de ${total} sementes seguem @${c.autor}`]
  if (c.desempenho !== 1) partes.push(c.desempenho > 1 ? `post fez ${vezes(c.desempenho)} o normal do autor` : `abaixo do normal do autor (${vezes(c.desempenho)})`)
  return partes.join('; ')
}

/* ------------------------------------------------------------ radar */

export interface TemaRadar {
  tema: string
  chave: string
  score: number
  posts: Candidata[]
  autores: number
  sementes: number
}

/**
 * Agrupa os posts de radar por tema. Temas que estao no territorio ou que o
 * creator dispensou nao voltam. Adotado e depois tirado do territorio volta.
 */
export function agruparRadar(radar: Candidata[], excluir: Set<string>, mapaSementes: Map<string, Set<string>>): TemaRadar[] {
  const grupos = new Map<string, TemaRadar>()
  for (const c of radar) {
    const nome = (c.radarTema ?? '').trim()
    const chave = chaveTema(nome)
    if (!chave || excluir.has(chave)) continue
    const g = grupos.get(chave) ?? { tema: nome, chave, score: 0, posts: [], autores: 0, sementes: 0 }
    g.score += c.score
    g.posts.push(c)
    grupos.set(chave, g)
  }
  for (const g of grupos.values()) {
    const autores = new Set(g.posts.map((p) => p.autor))
    g.autores = autores.size
    const sementes = new Set<string>()
    for (const a of autores) for (const s of mapaSementes.get(a) ?? []) sementes.add(s)
    g.sementes = sementes.size
    g.posts.sort((a, b) => b.score - a.score)
  }
  // um post solto nao e tendencia: precisa de mais de um post ou mais de uma conta
  return [...grupos.values()].filter((g) => g.posts.length >= 2 || g.autores >= 2).sort((a, b) => b.score - a.score)
}

function sementesPorConta(personaId: string): Map<string, Set<string>> {
  const rows = db.all<{ u: string; s: string }>(sql`
    select g.username as u, g.semente as s from seguindo g
    join semente s on s.username = g.semente and s.persona_id = ${personaId} and s.status = 'confirmada'
  `)
  const m = new Map<string, Set<string>>()
  for (const r of rows) {
    const set = m.get(r.u) ?? new Set<string>()
    set.add(r.s)
    m.set(r.u, set)
  }
  return m
}

async function gravarRadar(p: Persona, semana: string, radar: Candidata[], total: number): Promise<number> {
  const t = territorioDe(p)
  const excluir = new Set<string>([
    ...(t ? [...t.temas, ...t.pessoal].map((x) => chaveTema(x.tema)) : []),
    ...db
      .all<{ t: string }>(sql`select radar_tema as t from ideia where persona_id = ${p.id} and tipo = 'radar' and status = 'recusada' and radar_tema is not null`)
      .map((r) => chaveTema(r.t)),
  ])
  const temas = agruparRadar(radar, excluir, sementesPorConta(p.id)).slice(0, config.RADAR_TEMAS)
  await db.delete(ideia).where(and(eq(ideia.personaId, p.id), eq(ideia.semana, semana), eq(ideia.tipo, 'radar'), eq(ideia.status, 'nova')))
  let ordem = 0
  for (const g of temas) {
    ordem++
    await db.insert(ideia).values({
      personaId: p.id,
      semana,
      tipo: 'radar',
      ordem,
      titulo: g.tema,
      radarTema: g.tema,
      porQue: `${g.posts.length} posts de ${g.autores} ${g.autores === 1 ? 'conta' : 'contas'} que o público segue; ${g.sementes} de ${total} sementes seguem quem fala disso`,
      evidencias: g.posts.slice(0, 4).map((c) => c.postId),
      score: g.score,
    })
  }
  return temas.length
}

/* ------------------------------------------------------------ formatos */

export interface FormatoRef {
  id: string
  postId: string
  shortcode: string
  autor: string
  tipo: string | null
  duracao: number | null
  slides: number | null
  gancho: string | null
  primeiraLinha: string | null
  cta: string | null
  desempenho: number
  sementes: number
}

/**
 * Os posts do grafo que o publico mais consome, de qualquer assunto: servem de
 * EMBALAGEM (tipo, duracao, gancho, estrutura). O assunto vem das referencias.
 * Ordena por alcance x desempenho, no maximo 2 por autor.
 */
export async function formatosDoPublico(personaId: string, limite = 8): Promise<FormatoRef[]> {
  const posts = postsJanela(personaId).filter((p) => p.origem === 'grafo')
  if (posts.length === 0) return []
  const { total, mapa } = await sementesPorAutor(personaId)
  const hist = historicoEngajamento([...new Set(posts.map((p) => p.autor))])
  const pont = pontuarPosts(posts.map((p) => ({ postId: p.id, autor: p.autor, likes: p.likes, comments: p.comments, confianca: 1 })), hist, mapa, total)
  const porId = new Map(posts.map((p) => [p.id, p]))
  const porAutor = new Map<string, number>()
  const escolhidos = pont.filter((x) => {
    const n = porAutor.get(x.autor) ?? 0
    porAutor.set(x.autor, n + 1)
    return n < 2 && x.desempenho >= 1
  }).slice(0, limite)
  if (escolhidos.length === 0) return []

  const ids = escolhidos.map((x) => x.postId)
  const lista = sql.join(ids.map((i) => sql`${i}`), sql`, `)
  const feats = new Map(
    db
      .all<{ postId: string; output: string }>(sql`select post_id as postId, output from enrichment where kind = 'features' and post_id in (${lista})`)
      .map((r) => [r.postId, JSON.parse(r.output) as Record<string, unknown>]),
  )
  const midia = new Map(
    db
      .all<{ postId: string; dur: number | null; slides: number }>(sql`
        select post_id as postId, max(case when kind = 'video' then duration_s end) as dur,
          count(distinct case when kind = 'image' then position end) as slides
        from media_asset where post_id in (${lista}) group by post_id
      `)
      .map((r) => [r.postId, r]),
  )
  return escolhidos.map((x, i) => {
    const p = porId.get(x.postId)
    const f = feats.get(x.postId) ?? {}
    const m = midia.get(x.postId)
    const str = (v: unknown) => (typeof v === 'string' && v ? v : null)
    return {
      id: `F${i + 1}`,
      postId: x.postId,
      shortcode: p?.shortcode ?? '',
      autor: x.autor,
      tipo: p?.tipo ?? null,
      duracao: m?.dur ? Math.round(m.dur) : typeof f['videoDurationS'] === 'number' ? Math.round(f['videoDurationS'] as number) : null,
      slides: m && m.slides > 1 ? m.slides : null,
      gancho: str(f['hookType']),
      primeiraLinha: str(f['firstLine']),
      cta: str(f['ctaType']),
      desempenho: x.desempenho,
      sementes: x.sementes,
    }
  })
}

/** Mediana de duracao dos reels que o publico consome, para a dica de formato. */
export function resumoFormatos(fs: FormatoRef[]): string {
  if (fs.length === 0) return ''
  const tipos = new Map<string, number>()
  for (const f of fs) tipos.set(f.tipo ?? 'outro', (tipos.get(f.tipo ?? 'outro') ?? 0) + 1)
  const durs = fs.map((f) => f.duracao).filter((d): d is number => d !== null)
  const med = mediana(durs)
  return `${[...tipos.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) => `${n} ${t}`).join(', ')}${med ? `; vídeos com mediana de ${Math.round(med)}s` : ''}`
}

/* ------------------------------------------------------------ pauta */

function feedbackTexto(personaId: string): string {
  const rows = db.all<{ titulo: string; status: string; motivo: string | null; nota: string | null }>(sql`
    select titulo, status, motivo, nota from ideia
    where persona_id = ${personaId} and tipo = 'pauta' and status in ('aceita', 'recusada')
    order by feedback_at desc limit 20
  `)
  return rows
    .map((r) => {
      const m = r.motivo && r.motivo in MOTIVOS_RECUSA ? MOTIVOS_RECUSA[r.motivo as MotivoRecusa] : r.motivo
      return `- ${r.status === 'aceita' ? 'ACEITA' : `RECUSADA (${m ?? 'sem motivo'})`}: "${corta(r.titulo, 120)}"${r.nota ? ` — ${corta(r.nota, 160)}` : ''}`
    })
    .join('\n')
}

/** Ideias ja sugeridas (inclusive as desta semana): a IA nao repete o assunto. */
function titulosRecentes(personaId: string): string[] {
  return db
    .all<{ t: string }>(sql`select titulo as t from ideia where persona_id = ${personaId} and tipo = 'pauta' and status <> 'recusada' order by created_at desc limit 40`)
    .map((r) => r.t)
}

const CANDIDATAS_POR_PAUTA = 14
/** a partir disto (x o normal do autor) o formato do proprio post ja basta */
const FORMATO_PROPRIO_OK = 1
/** abaixo disto (x o normal do autor) o post so vira referencia se faltar opcao */
const DESEMPENHO_MINIMO_PAUTA = 0.6

/** Uma conta so pode inspirar tantas ideias por semana. */
export const MAX_POR_AUTOR = 1

/** Quantas ideias por autor: 1, a nao ser que nao haja autores diferentes suficientes. */
export function tetoPorAutor(autoresDistintos: number, ideias = config.PAUTA_IDEIAS): number {
  if (autoresDistintos <= 0) return MAX_POR_AUTOR
  return Math.max(MAX_POR_AUTOR, Math.ceil(ideias / autoresDistintos))
}

/** Autores que ja tem ideia na pauta desta semana (as que vao ficar). */
function autoresDaSemana(personaId: string, semana: string, modo: ModoPauta): Map<string, number> {
  const rows = db.all<{ autor: string }>(sql`
    select lower(a.username) as autor from ideia i
    join post p on p.id = i.post_id join author a on a.id = p.author_id
    where i.persona_id = ${personaId} and i.semana = ${semana} and i.tipo = 'pauta'
      and ${modo === 'mais' ? sql`i.status in ('nova', 'aceita')` : sql`i.status = 'aceita'`}
  `)
  const m = new Map<string, number>()
  for (const r of rows) m.set(r.autor, (m.get(r.autor) ?? 0) + 1)
  return m
}

/** Autores usados nas duas semanas anteriores: perdem prioridade, para a pauta girar. */
function autoresRecentes(personaId: string, semana: string): Set<string> {
  return new Set(
    db
      .all<{ autor: string }>(sql`
        select distinct lower(a.username) as autor from ideia i
        join post p on p.id = i.post_id join author a on a.id = p.author_id
        where i.persona_id = ${personaId} and i.tipo = 'pauta' and i.semana < ${semana}
          and i.semana >= (select coalesce(min(s), '') from (select distinct semana as s from ideia
            where persona_id = ${personaId} and semana < ${semana} order by semana desc limit 2))
      `)
      .map((r) => r.autor),
  )
}

/**
 * Escolhe as candidatas variando autores: no maximo MAX_POR_AUTOR por conta,
 * contando quem ja esta na pauta. Autor das ultimas semanas vai para o fim da
 * fila. So se faltar variedade e que libera mais de um post da mesma conta.
 */
export function diversificar(dentro: Candidata[], jaNaPauta: Map<string, number>, recentes: Set<string>, limite: number, minimo: number): Candidata[] {
  const peso = (c: Candidata) => (recentes.has(c.autor) ? c.score * 0.5 : c.score)
  const ordenadas = [...dentro].sort((a, b) => peso(b) - peso(a))
  for (let teto = MAX_POR_AUTOR; teto <= 3; teto++) {
    const cont = new Map(jaNaPauta)
    const out: Candidata[] = []
    for (const c of ordenadas) {
      const n = cont.get(c.autor) ?? 0
      if (n >= teto) continue
      cont.set(c.autor, n + 1)
      out.push(c)
      if (out.length >= limite) break
    }
    if (out.length >= minimo || teto === 3) return out
  }
  return []
}

export async function montarPauta(p: Persona, semana = semanaDe(), modo: ModoPauta = 'mais', comImagens = false): Promise<Montagem & { candidatas: Candidata[]; totalSementes: number; radar: Candidata[] }> {
  const t = territorioDe(p)
  const vazio = { tipo: 'pauta' as const, itens: 0, prompt: '', candidatas: [], totalSementes: 0, radar: [] }
  if (!t) return { ...vazio, motivo: 'a persona ainda não tem território' }
  const { dentro, radar, totalSementes } = await pontuados(p.id, semana, { modo })
  if (dentro.length === 0) {
    const motivo = modo === 'mais'
      ? 'não sobrou post "dentro" do território que ainda não tenha virado ideia: visite mais contas ou alargue o território'
      : 'nenhum post "dentro" do território na janela: rode o encaixe, ou alargue o território'
    return { ...vazio, radar, totalSementes, motivo }
  }

  // variedade: uma conta so por ideia; quem apareceu nas ultimas semanas vai para o fim
  const jaNaPauta = autoresDaSemana(p.id, semana, modo)
  // post que rendeu bem abaixo do normal do proprio autor nao prova que o assunto prende;
  // so entra se nao houver alternativa suficiente
  const fortes = dentro.filter((c) => c.desempenho >= DESEMPENHO_MINIMO_PAUTA)
  const base = fortes.length >= config.PAUTA_IDEIAS * 2 ? fortes : dentro
  const candidatas = diversificar(base, jaNaPauta, autoresRecentes(p.id, semana), CANDIDATAS_POR_PAUTA, config.PAUTA_IDEIAS)
  const n = Math.min(config.PAUTA_IDEIAS, candidatas.length)
  const teto = tetoPorAutor(new Set(candidatas.map((c) => c.autor)).size, n)

  const itens = candidatas.map((c) => ({
    post_id: c.post.shortcode,
    autor: `@${c.autor}`,
    por_que_o_publico_consome: porQueDe(c, totalSementes),
    tipo: c.post.tipo,
    // o proprio post ja prova o formato quando rendeu no nivel do autor ou acima
    formato_do_proprio_post_funciona: c.desempenho >= FORMATO_PROPRIO_OK,
    tema: c.tema,
    tema_do_territorio: c.temaTerritorio,
    angulo_sugerido: c.angulo,
    legenda: corta(c.post.caption, 700),
    fala_do_video: c.post.fala ? corta(c.post.fala, 700) : null,
  }))
  // carrossel e foto: o conteudo esta nos slides; reels ja vai com a transcricao
  const sl = comImagens ? await slidesDosPosts(candidatas.map((c) => c.post), 6, 420) : null
  for (const it of itens) {
    const n = sl?.porShortcode.get(it.post_id)
    if (n) Object.assign(it, { slides_em_imagem: n })
  }
  const feedback = feedbackTexto(p.id)
  const recentes = titulosRecentes(p.id)
  const formatos = await formatosDoPublico(p.id)
  const temRefs = candidatas.some((c) => c.post.origem === 'referencia')
  const formatosItens = formatos.map((f) => ({
    id: f.id,
    autor: `@${f.autor}`,
    tipo: f.tipo,
    duracao_s: f.duracao,
    slides: f.slides,
    tipo_de_gancho: f.gancho,
    primeira_linha: f.primeiraLinha ? corta(f.primeiraLinha, 160) : null,
    chamada_final: f.cta,
    sinal: `${f.sementes} de ${totalSementes} sementes seguem; ${vezes(f.desempenho)} o normal do autor`,
  }))

  const prompt = `# Tarefa (creator · pauta · ${semana})

Monte a pauta da semana de ${p.nome} no Instagram pessoal: **${n} ideias**. O objetivo não é vender nada: é postar o tipo de conteúdo que o público dele já consome, com a voz e as histórias dele, para se aproximar dessas pessoas.

## Território de ${p.nome}

${territorioTexto(t, p.nome)}
${feedback ? `\n## O que ${p.nome} achou das pautas anteriores (siga esse gosto)\n\n${feedback}\n` : ''}${recentes.length ? `\n## Ideias que já foram sugeridas (não repita o assunto nem o ângulo)\n\n${recentes.map((x) => `- ${x}`).join('\n')}\n` : ''}
## Como montar

- Carrossel e foto: o conteúdo está no texto das imagens. Quando o item tem "slides_em_imagem", as imagens marcadas [post ID · slide N] vêm antes deste texto: leia cada slide e use o que eles dizem, não só a legenda.
- Cada ideia parte de UM post de referência da lista (copie o "post_id"). Escolha as ${n} melhores, na ordem de prioridade; a lista já vem ordenada pelo sinal do público.${temRefs ? `
- O ASSUNTO vem de preferência dos posts marcados "referência de conteúdo": são pessoas como ${p.nome}, falando do que ele fala.` : ''}${formatos.length ? `
- EMBALAGEM: se "formato_do_proprio_post_funciona" for true, use o formato do próprio post de referência e deixe "formato_ref" vazio. Só quando for false (o assunto é bom mas o post não engajou) escolha um "formato_ref" (F1, F2...) da lista "Formatos que o público consome" e adapte "formato" e "hook" a ele — o tipo de vídeo, a duração, o jeito de abrir. Também pode usar um F quando o formato do post não combina com ${p.nome}. Não force: a lista de formatos é uma ajuda, não uma obrigação.` : ''}
- No máximo ${teto === 1 ? 'UMA ideia' : `${teto} ideias`} por autor de referência: a pauta tem que mostrar o que o público consome de vários lugares, não de uma conta só.
- "angulo": como ${p.nome} faz a versão DELE, ancorada em algo concreto do território (uma história, opinião, erro ou experiência que ele contou). Diga qual. Nunca copie o post de referência.
- Se o território não tem a história de que a ideia precisa, NÃO escreva "ele deve escolher um exemplo real". Termine o ângulo com uma pergunta direta para ${p.nome} responder antes de gravar, começando por "Pergunta para ${p.nome}:" (ex.: "Pergunta para ${p.nome}: qual projeto mudou de escopo no meio e o que você aprendeu?").
- Não repita a mesma história do território em mais de uma ideia.
- Não cite ids internos (F1, F2...) nem números de desempenho nos textos.
- "hook": a primeira frase do post ou a primeira fala do vídeo, no tom dele. Curta.
- "formato": quando "formato_do_proprio_post_funciona" é true, descreva o formato REAL do post de referência (tipo, duração, estrutura, ex.: "reels falado de ~40s listando 5 livros, um por público") — não invente cenário nem estrutura nova. Senão, reels_fala, reels_bastidor, carrossel, foto_legenda ou stories, de preferência entre os formatos em que ele fica à vontade.
- "por_que": em uma frase, por que esse público vai assistir (use o sinal que veio no item).
- NÃO escreva roteiro nem legenda completa. A ideia é o ponto de partida; o texto é dele.
- Varie temas e formatos. Nada da lista FORA.
- TESTE DO COMPRADOR: o público é quem CONTRATA tecnologia, não quem faz. Descarte ideia que só interessa a dev ou a outra software house (precificação/margem de software, stack, código, gestão de dev, como vender serviço). A ideia boa faz um dono de empresa pensar "esse cara entende do meu problema" — fala da dor, da decisão ou do resultado do negócio, não do bastidor técnico.

${FORMATO_PAUTA}

## Posts de referência (${itens.length})

\`\`\`json
${JSON.stringify(itens, null, 1)}
\`\`\`
${formatos.length ? `\n## Formatos que o público consome (${resumoFormatos(formatos)})\n\nOs posts do grafo que mais renderam, de qualquer assunto. Use só a forma, não o tema.\n\n\`\`\`json\n${JSON.stringify(formatosItens, null, 1)}\n\`\`\`\n` : ''}`
  return { tipo: 'pauta', itens: itens.length, prompt, candidatas, totalSementes, radar, imagens: sl?.imagens.length ? sl.imagens : undefined }
}

const FORMATO_PAUTA = `## Formato da resposta

Responda SOMENTE com um bloco de código \`\`\`json, sem texto antes ou depois:

\`\`\`json
{
  "ideias": [
    { "post_id": "SHORTCODE", "formato_ref": "F1", "titulo": "a ideia em uma linha", "por_que": "por que o público assiste", "angulo": "a versão dele e em que história/opinião se apoia", "hook": "primeira frase, no jeito do formato escolhido", "formato": "ex.: reels_fala de ~40s abrindo com contraste" }
  ]
}
\`\`\``

/**
 * Grava a pauta da semana. Refazer apaga so as ideias ainda sem resposta:
 * o que o creator aceitou ou recusou fica.
 */
export async function aplicarPauta(p: Persona, texto: string, modelo: string, semana = semanaDe(), modo: ModoPauta = 'mais'): Promise<Aplicacao> {
  const json = extrairJson(texto)
  const lista = Array.isArray((json as Record<string, unknown>)?.['ideias']) ? ((json as Record<string, unknown>)['ideias'] as unknown[]) : extrairLista(texto)
  const r: Aplicacao = { tipo: 'pauta', gravados: 0, desconhecidos: [], invalidos: [] }
  const { dentro, radar, totalSementes } = await pontuados(p.id, semana)
  const porShort = new Map(dentro.map((c) => [c.post.shortcode, c]))
  const formatos = new Map((await formatosDoPublico(p.id)).map((f) => [f.id, f]))

  // ideia que ja tem roteiro fica: o creator ja trabalhou nela
  if (modo === 'refazer') await db.delete(ideia).where(and(eq(ideia.personaId, p.id), eq(ideia.semana, semana), eq(ideia.tipo, 'pauta'), eq(ideia.status, 'nova'), sql`not exists (select 1 from roteiro r where r.ideia_id = ${ideia.id})`))
  const jaTem = db.all<{ n: number }>(sql`select count(*) as n from ideia where persona_id = ${p.id} and semana = ${semana} and tipo = 'pauta'`)[0]?.n ?? 0

  let ordem = jaTem
  const autoresNaPauta = autoresDaSemana(p.id, semana, modo)
  const jaNaPauta = new Set(
    db.all<{ id: string }>(sql`select post_id as id from ideia where persona_id = ${p.id} and tipo = 'pauta' and semana = ${semana} and post_id is not null`).map((x) => x.id),
  )
  const tetoAutor = tetoPorAutor(new Set(dentro.map((c) => c.autor)).size)
  for (const bruto of lista) {
    const id = String((bruto as Record<string, unknown> | null)?.['post_id'] ?? '?')
    const parsed = ideiaAnswer.safeParse(bruto)
    if (!parsed.success) {
      r.invalidos.push({ id, erro: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') })
      continue
    }
    const a = parsed.data
    const c = porShort.get(a.post_id.trim())
    if (!c) {
      r.desconhecidos.push(a.post_id)
      continue
    }
    if (jaNaPauta.has(c.postId)) {
      r.invalidos.push({ id: a.post_id, erro: 'este post ja tem ideia nesta semana' })
      continue
    }
    jaNaPauta.add(c.postId)
    const usados = autoresNaPauta.get(c.autor) ?? 0
    if (usados >= tetoAutor) {
      r.invalidos.push({ id: a.post_id, erro: `@${c.autor} ja tem ideia nesta pauta` })
      continue
    }
    autoresNaPauta.set(c.autor, usados + 1)
    // o formato de outro post so entra quando o proprio post nao provou o dele
    const formatoRef = a.formato_ref && c.desempenho < FORMATO_PROPRIO_OK ? formatos.get(a.formato_ref.trim().toUpperCase()) : undefined
    ordem++
    await db.insert(ideia).values({
      personaId: p.id,
      semana,
      tipo: 'pauta',
      ordem,
      postId: c.postId,
      titulo: a.titulo,
      porQue: [a.por_que, `(${porQueDe(c, totalSementes)})`].filter(Boolean).join(' '),
      angulo: a.angulo,
      hook: a.hook || null,
      formato: a.formato || null,
      evidencias: [c.postId, ...(formatoRef && formatoRef.postId !== c.postId ? [formatoRef.postId] : [])],
      score: c.score,
      modelo,
    })
    r.gravados++
  }
  const temas = await gravarRadar(p, semana, radar, totalSementes)
  r.extra = { radar: temas, semana }
  return r
}

export interface PautaSummary {
  semana: string
  ideias: number
  radar: number
  motivo?: string
}

/** Gera a pauta da semana pela API. Sem refazer, nao mexe numa pauta que ja existe. */
/**
 * Gera ideias pela API. Por padrao ACRESCENTA a pauta da semana: so usa posts
 * que ainda nao viraram ideia, entao rodar todo dia so traz o que e novo.
 */
export async function gerarPauta(opts: { personaId?: string; semana?: string; refazer?: boolean } = {}): Promise<PautaSummary> {
  const p = await exigirPersona(opts.personaId)
  const semana = opts.semana ?? semanaDe()
  const modo: ModoPauta = opts.refazer ? 'refazer' : 'mais'
  const m = await montarPauta(p, semana, modo, true)
  if (m.itens === 0) {
    // mesmo sem pauta, o radar pode ter algo a dizer
    const radar = await gravarRadar(p, semana, m.radar, m.totalSementes)
    return { semana, ideias: 0, radar, motivo: m.motivo }
  }
  if (!temApi()) throw new Error('sem ANTHROPIC_API_KEY no .env: use o fluxo manual do painel (copiar prompt / colar resposta)')
  logger.info({ semana, candidatas: m.itens }, 'gerando a pauta')
  const { texto, modelo } = await perguntarLlm(m.prompt, { modelo: modeloPauta(), maxTokens: 6_000, imagens: m.imagens })
  const a = await aplicarPauta(p, texto, modelo, semana, modo)
  if (a.invalidos.length || a.desconhecidos.length) logger.warn({ invalidos: a.invalidos, desconhecidos: a.desconhecidos }, 'itens da pauta descartados')
  return { semana, ideias: a.gravados, radar: Number(a.extra?.['radar'] ?? 0) }
}

/* ------------------------------------------------------------ feedback */

export async function responderIdeia(id: string, dados: { status: 'aceita' | 'recusada' | 'nova'; motivo?: string | null; nota?: string | null }): Promise<boolean> {
  const motivo = dados.status === 'recusada' && dados.motivo && dados.motivo in MOTIVOS_RECUSA ? dados.motivo : null
  if (dados.status === 'recusada' && !motivo) throw new Error('recusa precisa de motivo: tema, tom, ja_falei ou ruim')
  const rows = await db
    .update(ideia)
    .set({
      status: dados.status,
      motivo,
      nota: dados.nota?.trim().slice(0, 600) || null,
      feedbackAt: dados.status === 'nova' ? null : new Date(),
    })
    .where(and(eq(ideia.id, id), eq(ideia.tipo, 'pauta')))
    .returning({ id: ideia.id })
  return rows.length > 0
}

/**
 * O creator adota um tema do radar: entra no territorio (pessoal ou
 * profissional) e o encaixe dos posts e refeito na proxima rodada.
 */
export async function adotarRadar(id: string, como: 'pessoal' | 'temas', detalhe?: string | null): Promise<void> {
  const [i] = await db.select().from(ideia).where(and(eq(ideia.id, id), eq(ideia.tipo, 'radar'))).limit(1)
  if (!i) throw new Error('tema do radar nao encontrado')
  const p = await exigirPersona(i.personaId)
  const t = territorioDe(p)
  if (!t) throw new Error('a persona nao tem territorio')
  const tema = { tema: i.radarTema ?? i.titulo, detalhe: detalhe?.trim() || 'adotado do radar' }
  const lista = como === 'pessoal' ? t.pessoal : t.temas
  if (!lista.some((x) => chaveTema(x.tema) === chaveTema(tema.tema))) lista.push(tema)
  await salvarTerritorio(p.id, t)
  await db.update(ideia).set({ status: 'adotado', nota: detalhe?.trim() || null, feedbackAt: new Date() }).where(eq(ideia.id, id))
}

export async function dispensarRadar(id: string): Promise<void> {
  await db.update(ideia).set({ status: 'recusada', motivo: 'tema', feedbackAt: new Date() }).where(and(eq(ideia.id, id), eq(ideia.tipo, 'radar')))
}

export async function removerIdeias(ids: string[]): Promise<void> {
  if (!ids.length) return
  await db.delete(roteiro).where(inArray(roteiro.ideiaId, ids))
  await db.delete(ideia).where(inArray(ideia.id, ids))
}
