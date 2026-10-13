import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { and, eq, sql } from 'drizzle-orm'
import { all, db } from '../db/client'
import { encaixe, personaConta } from '../db/schema'
import { extrairJson, extrairLista } from '../llm/json'
import { logger } from '../shared/logger'
import { isStopRequested } from '../shared/stop'
import { atualizarGrafo } from './grafo'
import { adicionarReferencias } from './referencias'
import { adicionarSementes, exigirPersona, foraDaEntrevista, salvarTerritorio, territorioDe, type Persona } from './persona'
import { fontesConteudo, versaoEncaixe, corta, encaixesDe, postsJanela, sementesPorAutor, territorioTexto, type PostJanela } from './dados'
import { perguntarLlm, temApi } from './llm'
import { ehDeImagem, slidesDosPosts, type Imagem } from '../enricher/quadros'
import { PERGUNTAS, contaAnswer, encaixeAnswer, territorio as territorioSchema } from './tipos'

/**
 * As tarefas de IA do creator. Cada uma tem duas metades: `montar` (o prompt,
 * que tambem serve para colar numa conversa quando nao ha chave de API) e
 * `aplicar` (le a resposta e grava). `rodar` junta as duas pela API.
 */
export type TipoTarefa = 'territorio' | 'contas' | 'encaixe' | 'pauta'

export interface Montagem {
  tipo: TipoTarefa
  itens: number
  prompt: string
  /** por que nao ha nada a fazer, quando itens = 0 */
  motivo?: string
  /** slides de carrossel e foto, so na chamada pela API (o fluxo manual leva so o texto) */
  imagens?: Imagem[]
}

export interface Aplicacao {
  tipo: TipoTarefa
  gravados: number
  desconhecidos: string[]
  invalidos: { id: string; erro: string }[]
  extra?: Record<string, unknown>
}

const FORMATO = (json: string) => `## Formato da resposta

Responda SOMENTE com um bloco de código \`\`\`json, sem texto antes ou depois:

\`\`\`json
${json}
\`\`\``

/* ------------------------------------------------------------ territorio */

export function montarTerritorio(p: Persona): Montagem {
  const respostas = PERGUNTAS.filter((q) => q.chave !== 'fora' && (p.entrevista[q.chave] ?? '').trim())
  if (!(p.entrevista['quem_e'] ?? '').trim() || !(p.entrevista['publico'] ?? '').trim()) {
    return { tipo: 'territorio', itens: 0, prompt: '', motivo: 'responda pelo menos "quem é você" e "quem você quer que te assista"' }
  }
  const entrevista = respostas.map((q) => `**${q.pergunta}**\n${p.entrevista[q.chave]?.trim()}`).join('\n\n')
  const prompt = `# Tarefa (creator · território · v1)

${p.nome} vai postar no Instagram pessoal para se aproximar de quem ele quer atrair — não é conteúdo corporativo, é conteúdo que essa pessoa gosta de ver e que cria conexão. Abaixo está a entrevista que ${p.nome} respondeu. Monte o **território** dele: os temas em que ele tem algo verdadeiro para dizer.

## Entrevista

${entrevista}

## Regras

- Use SÓ o que está na entrevista. Não invente história, cargo, número nem hobby.
- Cada tema precisa de um "detalhe" que cite o que ele disse (a história, a opinião ou a experiência que sustenta o tema). Tema sem lastro na entrevista não entra.
- A entrevista é curta de propósito. Extraia o que der, sem encher: 2 a 8 temas é normal. Lista vazia é melhor que item inventado.
- "temas": temas profissionais, específicos (ex.: "contratar o primeiro time de tecnologia", não "liderança").
- "pessoal": o lado pessoal que ele topou mostrar (esporte, família, hobby...). É daí que vem a aproximação — não descarte.
- "publico": reescreva em uma ou duas frases quem ele quer atrair.
- "formatos": entre reels_fala, reels_bastidor, carrossel, foto_legenda, stories — só os que combinam com o que ele disse.
- Não preencha "fora": essa parte só o creator escreve.

${FORMATO(`{
  "resumo": "2 ou 3 frases: quem é, o que faz, o que o diferencia",
  "publico": "quem ele quer atrair",
  "temas": [{ "tema": "tema específico", "detalhe": "o que ele tem a dizer, citando a entrevista" }],
  "pessoal": [{ "tema": "ex.: corrida", "detalhe": "o que ele contou" }],
  "opinioes": ["opinião forte, com as palavras dele"],
  "historias": ["história em uma frase"],
  "tom": "como ele quer soar",
  "formatos": ["reels_fala"]
}`)}
`
  return { tipo: 'territorio', itens: 1, prompt }
}

export async function aplicarTerritorio(p: Persona, texto: string): Promise<Aplicacao> {
  const json = extrairJson(texto)
  const t = territorioSchema.parse({ ...(json as Record<string, unknown>), fora: foraDaEntrevista(p.entrevista) })
  await salvarTerritorio(p.id, t)
  return { tipo: 'territorio', gravados: 1, desconhecidos: [], invalidos: [], extra: { temas: t.temas.length, pessoal: t.pessoal.length } }
}

/* ------------------------------------------------------------ contas do grafo */

interface ContaRow {
  username: string
  sementes: number
  fullName: string | null
  category: string | null
  biography: string | null
  followers: number | null
  authorId: string | null
}

/**
 * Contas do grafo ja visitadas (com bio ou posts) e ainda sem papel da IA.
 * Sem visita a IA so teria o nome para julgar.
 */
/** a partir daqui a classificacao ve falas e imagens; as classificadas antes (so pela legenda) sao refeitas uma vez */
const CONTAS_COM_MIDIA_DESDE = 1791552600

async function contasPendentes(personaId: string, limite: number, refazer: boolean, so?: string[]): Promise<ContaRow[]> {
  return await all<ContaRow>(sql`
    select g.username, g.sementes, a.full_name as "fullName", a.category, a.biography, a.followers_count as followers, a.id as "authorId"
    from persona_conta g
    join author a on lower(a.username) = g.username
    where g.persona_id = ${personaId} and g.source = 'grafo'
      and (a.last_watched_at is not null or a.biography is not null)
      ${refazer ? sql`` : sql`and not exists (select 1 from persona_conta c where c.persona_id = g.persona_id and c.username = g.username and c.source = 'llm' and c.created_at >= ${CONTAS_COM_MIDIA_DESDE})`}
      ${so?.length ? sql`and g.username in (${sql.join(so.map((u) => sql`${u.toLowerCase()}`), sql`, `)})` : sql``}
    order by g.sementes desc
    limit ${limite}
  `)
}

export async function montarContas(p: Persona, limite = 25, refazer = false, so?: string[], comImagens = false): Promise<Montagem> {
  const rows = await contasPendentes(p.id, limite, refazer, so)
  if (rows.length === 0) return { tipo: 'contas', itens: 0, prompt: '', motivo: 'nenhuma conta do grafo visitada e sem avaliação' }
  const { total } = await sementesPorAutor(p.id)
  const t = territorioDe(p)
  // legenda de Instagram diz pouco: vai a fala do reels e, de foto e carrossel, as imagens
  const paraImagem: { shortcode: string; tipo: string | null }[] = []
  const itens = await Promise.all(rows.map(async (r) => {
    const posts = r.authorId
      ? await all<{ shortcode: string; tipo: string | null; caption: string | null; fala: string | null }>(sql`
          select p.shortcode, p.media_type as tipo, p.caption,
            (select (e.output->>'text') from enrichment e where e.post_id = p.id and e.kind = 'transcript'
              and coalesce((e.output->>'text'), '') <> '' limit 1) as fala
          from post p where p.author_id = ${r.authorId} order by p.taken_at desc limit 5`)
      : []
    let comFoto = 0
    for (const x of posts) if (ehDeImagem(x.tipo) && comFoto < 3) { paraImagem.push(x); comFoto++ }
    return {
      id: `@${r.username}`,
      nome: r.fullName,
      categoria: r.category,
      seguidores: r.followers,
      bio: r.biography ? corta(r.biography, 300) : null,
      sementes_que_seguem: `${r.sementes} de ${total}`,
      posts_recentes: posts.map((x) => ({
        id: x.shortcode,
        tipo: x.tipo,
        legenda: x.caption ? corta(x.caption, 220) : null,
        fala_do_video: x.fala ? corta(x.fala, 300) : null,
      })),
    }
  }))
  let imagens: Imagem[] | undefined
  if (comImagens && paraImagem.length) {
    const fotos = await slidesDosPosts(paraImagem.filter((x) => x.tipo === 'image'), 1, 320, 40)
    const carr = await slidesDosPosts(paraImagem.filter((x) => x.tipo === 'carousel'), 2, 320, 80 - fotos.imagens.length)
    imagens = [...fotos.imagens, ...carr.imagens]
    const n = new Map([...fotos.porShortcode, ...carr.porShortcode])
    for (const it of itens) for (const x of it.posts_recentes) if (n.get(x.id)) Object.assign(x, { imagens: n.get(x.id) })
    if (!imagens.length) imagens = undefined
  }
  const publico = t?.publico || p.publico || '(não informado)'
  const temasTxt = (t?.temas || []).map((x) => x.tema).slice(0, 8).join('; ')
  const prompt = `# Tarefa (creator · contas do grafo · v2)

${p.nome} quer atrair este público no Instagram: **${publico}**

Pegamos perfis reais de pessoas desse público (as "sementes") e olhamos quem elas seguem em comum. As contas abaixo são seguidas por várias sementes. Diga o que cada uma é para ${p.nome}:

- **consumido**: produz conteúdo que esse público assiste — creator, especialista, podcast, mídia, empresário que posta com frequência, perfil de nicho (negócios, esporte, estilo de vida, o que for). É daqui que sai a pauta.
- **par**: é o próprio público (outro dono de empresa, executivo, gestor, founder, profissional da área) e posta pouco ou só coisa pessoal. Não serve de fonte de conteúdo, mas é uma nova semente.
- **fora**: não tem conteúdo a aprender — conta pessoal sem posts relevantes, loja ou empresa que só faz anúncio, perfil parado, fã-clube, conta de sorteio.

Duas marcações extras:

- **"candidata_semente": true** só para "par": alguém do público que posta pouco. Quem produz conteúdo com frequência NUNCA é semente, mesmo sendo da mesma área.
- **"candidata_referencia": true** para um "consumido" que é uma pessoa (não empresa nem mídia) postando conteúdo próprio sobre os mesmos assuntos de ${p.nome}${temasTxt ? ` (${temasTxt})` : ''} — alguém que faz o que ${p.nome} quer fazer. Vira sugestão de referência.

## Regras

- Use só os dados. O motivo cita a evidência (bio, categoria, legenda, fala ou imagem).
- Legenda de Instagram diz pouco. Leia a "fala_do_video" dos reels e, quando o post tem "imagens", as imagens marcadas [post ID · …] que vêm antes deste texto: é ali que se vê o que a conta posta de verdade.
- Perfil que só divulga vaga de emprego ou estágio, curso, produto, promoção, evento ou sorteio é "fora", mesmo que a legenda pareça conteúdo. Se as imagens são arte de anúncio repetida, é anúncio.
- Na dúvida, escolha o mais provável e use confiança abaixo de 0.6.
- "tema": do que a conta fala, em 1 a 4 palavras (vazio se for fora).
- Um objeto para CADA conta, com o mesmo "id".

${FORMATO(`[
  { "id": "@usuario", "papel": "consumido | par | fora", "confianca": 0.0, "motivo": "uma frase com a evidência", "tema": "do que fala", "candidata_semente": false, "candidata_referencia": false }
]`)}

## Contas (${itens.length})

\`\`\`json
${JSON.stringify(itens, null, 1)}
\`\`\`
`
  return { tipo: 'contas', itens: itens.length, prompt, imagens }
}

export async function aplicarContas(p: Persona, texto: string, modelo: string): Promise<Aplicacao> {
  const lista = extrairLista(texto)
  const r: Aplicacao = { tipo: 'contas', gravados: 0, desconhecidos: [], invalidos: [] }
  const doGrafo = new Set(
    (await all<{ u: string }>(sql`select username as u from persona_conta where persona_id = ${p.id} and source = 'grafo'`)).map((x) => x.u),
  )
  const sugeridas: { u: string; motivo: string }[] = []
  const refsSug: { u: string; motivo: string }[] = []
  for (const bruto of lista) {
    const id = String((bruto as Record<string, unknown> | null)?.['id'] ?? '?')
    const parsed = contaAnswer.safeParse(bruto)
    if (!parsed.success) {
      r.invalidos.push({ id, erro: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') })
      continue
    }
    const a = parsed.data
    const u = a.id.replace(/^@/, '').trim().toLowerCase()
    if (!doGrafo.has(u)) {
      r.desconhecidos.push(a.id)
      continue
    }
    const valores = {
      papel: a.papel,
      confianca: a.confianca,
      motivo: a.motivo,
      tema: a.tema || null,
      candidataSemente: a.papel === 'par',
      modelo,
      createdAt: new Date(),
    }
    await db
      .insert(personaConta)
      .values({ personaId: p.id, username: u, source: 'llm', ...valores })
      .onConflictDoUpdate({ target: [personaConta.personaId, personaConta.username, personaConta.source], set: valores })
    if (valores.candidataSemente) sugeridas.push({ u, motivo: a.motivo })
    if (a.papel === 'consumido' && a.candidata_referencia) refsSug.push({ u, motivo: a.motivo })
    r.gravados++
  }
  let novas = 0
  const refs = new Set((await all<{ u: string }>(sql`select username as u from referencia where persona_id = ${p.id}`)).map((x) => x.u))
  for (const s of sugeridas) {
    if (refs.has(s.u)) continue // ja e referencia: e creator, nao publico
    const add = await adicionarSementes(p.id, [s.u], { origem: 'grafo', status: 'sugerida', motivo: s.motivo })
    novas += add.adicionadas.length
  }
  let refsNovas = 0
  const sementesJa = new Set((await all<{ u: string }>(sql`select username as u from semente where persona_id = ${p.id} and status = 'confirmada'`)).map((x) => x.u))
  for (const s of refsSug) {
    if (sementesJa.has(s.u)) continue
    const add = await adicionarReferencias(p.id, [s.u], { status: 'sugerida', origem: 'grafo', motivo: s.motivo })
    refsNovas += add.adicionadas.length
  }
  // quem virou "fora" ou "par" sai do acompanhamento
  const grafo = await atualizarGrafo(p.id)
  r.extra = { sementesSugeridas: novas, referenciasSugeridas: refsNovas, acompanhadas: grafo.acompanhadas, liberadas: grafo.liberadas }
  return r
}

/* ------------------------------------------------------------ encaixe dos posts */

/** a partir daqui o encaixe ve os slides; avaliacao anterior de carrossel/foto e refeita uma vez */
const IMAGENS_NO_ENCAIXE_DESDE = 1791519600

async function postsSemEncaixe(p: Persona, limite: number, refazer: boolean, so?: string[]): Promise<PostJanela[]> {
  const enc = await encaixesDe(p.id)
  const filtro = so?.length ? new Set(so.map((u) => u.toLowerCase())) : null
  return (await postsJanela(p.id))
    .filter((x) => !filtro || filtro.has(x.autor))
    .filter((x) => (x.caption ?? '').trim() || (x.fala ?? '').trim() || (x.alt ?? '').trim() || ehDeImagem(x.tipo))
    .filter((x) => {
      if (refazer) return true
      const e = enc.get(x.id)
      if (!e) return true
      if (e.source === 'humano') return false
      if (e.versaoLlm !== versaoEncaixe(p.territorioVersao)) return true
      // carrossel e foto avaliados antes de a IA ver as imagens: avalia de novo, agora lendo os slides
      if (ehDeImagem(x.tipo) && e.avaliadoEm && e.avaliadoEm < IMAGENS_NO_ENCAIXE_DESDE) return true
      // a transcricao chegou depois da avaliacao: a IA julgou o reel so pela legenda
      return Boolean(x.falaEm && e.avaliadoEm && x.falaEm > e.avaliadoEm)
    })
    .slice(0, limite)
}

async function recusasPorTema(personaId: string): Promise<string> {
  const rows = await all<{ titulo: string; nota: string | null }>(sql`
    select titulo, nota from ideia where persona_id = ${personaId} and status = 'recusada' and motivo = 'tema'
    order by feedback_at desc limit 12
  `)
  return rows.map((r) => `- "${corta(r.titulo, 120)}"${r.nota ? ` — ${corta(r.nota, 160)}` : ''}`).join('\n')
}

async function temasDoRadar(personaId: string): Promise<string[]> {
  return (await all<{ t: string }>(sql`
      select min(radar_tema) as t, count(*) as n from encaixe where persona_id = ${personaId} and coalesce(radar_tema, '') <> ''
      group by lower(radar_tema) order by n desc limit 30
    `))
    .map((r) => r.t)
}

export async function montarEncaixe(p: Persona, limite = 20, refazer = false, so?: string[], comImagens = false): Promise<Montagem> {
  const t = territorioDe(p)
  if (!t) return { tipo: 'encaixe', itens: 0, prompt: '', motivo: 'a persona ainda não tem território: responda a entrevista e gere o território' }
  if ((await fontesConteudo(p.id)).length === 0) return { tipo: 'encaixe', itens: 0, prompt: '', motivo: 'nenhuma conta consumida no grafo nem referência de conteúdo ainda' }
  const posts = await postsSemEncaixe(p, limite, refazer, so)
  if (posts.length === 0) return { tipo: 'encaixe', itens: 0, prompt: '', motivo: 'todos os posts da janela já foram avaliados com o território atual' }

  const itens = posts.map((x) => ({
    id: x.shortcode,
    autor: `@${x.autor}`,
    autor_e: x.origem === 'referencia' ? 'referência de conteúdo (alguém como o creator)' : 'conta que o público consome',
    autor_fala_de: x.autorTema,
    tipo: x.tipo,
    publicado: x.takenAt ? new Date(x.takenAt * 1000).toISOString().slice(0, 10) : null,
    legenda: corta(x.caption, 900),
    fala_do_video: x.fala ? corta(x.fala, 800) : null,
    descricao_da_imagem: x.alt ? corta(x.alt, 200) : null,
  }))
  // carrossel e foto: o conteudo costuma estar so nos slides
  const sl = comImagens ? await slidesDosPosts(posts, 4, 360) : null
  for (const it of itens) {
    const n = sl?.porShortcode.get(it.id)
    if (n) Object.assign(it, { slides_em_imagem: n })
  }
  const recusas = await recusasPorTema(p.id)
  const radar = await temasDoRadar(p.id)
  const prompt = `# Tarefa (creator · encaixe · território v${p.territorioVersao})

Os posts abaixo são de contas que o público de ${p.nome} segue e consome. Para cada post, decida se ele cabe no **território** de ${p.nome}:

- **dentro**: o assunto conecta com um tema profissional ou com o lado pessoal do território, e ${p.nome} tem algo próprio a dizer (uma história, uma opinião, uma experiência da lista). Vira ideia de pauta.
- **radar**: o público claramente consome esse assunto e o post tem substância, mas ${p.nome} não declarou esse tema. Serve de dica para ele decidir se entra no território.
- **fora**: meme sem gancho, publicidade, sorteio, conteúdo raso, notícia sem ângulo, ou qualquer tema da lista FORA (sempre fora).

## Território de ${p.nome}

${territorioTexto(t, p.nome)}
${recusas ? `\n## Ideias que ${p.nome} recusou por "não é meu tema" (não repita o erro)\n\n${recusas}\n` : ''}
## Regras

- Julgue o assunto e a substância do post, não o autor.
- Carrossel e foto: o conteúdo costuma estar no texto das imagens, não na legenda. Quando o item tem "slides_em_imagem", as imagens marcadas [post ID · slide N] vêm antes deste texto: leia o texto de cada slide antes de julgar. Legenda curta não quer dizer post raso.
- TESTE DO PÚBLICO: o público de ${p.nome} é **${t.publico || p.publico || '(não informado)'}**. Pergunte: alguém desse público pararia para assistir e sairia achando ${p.nome} uma referência no assunto? Tema que só interessa a quem trabalha na mesma área de ${p.nome} (colegas de profissão, concorrentes, fornecedores), e não a esse público, é "fora" — mesmo que ${p.nome} entenda do tema. Se o público é justamente essa área, o tema vale.
- "tema": o assunto do post em 2 a 5 palavras.
- Se "dentro": "tema_territorio" = qual tema ou item pessoal do território conecta (copie o nome), e "angulo" = em uma frase, como ${p.nome} faria a versão DELE (qual história, opinião ou experiência dele usar). Não copie o post.
- Se "radar": "radar_tema" = o interesse em 1 a 3 palavras, genérico o bastante para agrupar posts parecidos (ex.: "corrida", "vinho", "paternidade").${radar.length ? ` Reaproveite um destes quando servir: ${radar.join(', ')}.` : ''}
- Espere que a maioria fique fora ou radar. "dentro" exige conexão real com o território.
- O motivo cita a evidência do post. Na dúvida, confiança abaixo de 0.6.
- Um objeto para CADA post, com o mesmo "id".

${FORMATO(`[
  { "id": "SHORTCODE", "encaixe": "dentro | radar | fora", "tema": "assunto do post", "tema_territorio": "", "angulo": "", "radar_tema": "", "confianca": 0.0, "motivo": "uma frase" }
]`)}

## Posts (${itens.length})

\`\`\`json
${JSON.stringify(itens, null, 1)}
\`\`\`
`
  return { tipo: 'encaixe', itens: itens.length, prompt, imagens: sl?.imagens.length ? sl.imagens : undefined }
}

export async function aplicarEncaixe(p: Persona, texto: string, modelo: string): Promise<Aplicacao> {
  const lista = extrairLista(texto)
  const r: Aplicacao = { tipo: 'encaixe', gravados: 0, desconhecidos: [], invalidos: [] }
  for (const bruto of lista) {
    const id = String((bruto as Record<string, unknown> | null)?.['id'] ?? '?')
    const parsed = encaixeAnswer.safeParse(bruto)
    if (!parsed.success) {
      r.invalidos.push({ id, erro: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') })
      continue
    }
    const a = parsed.data
    const [row] = await all<{ id: string }>(sql`select id from post where shortcode = ${a.id.trim()} limit 1`)
    if (!row) {
      r.desconhecidos.push(a.id)
      continue
    }
    const valores = {
      encaixe: a.encaixe,
      tema: a.tema || null,
      temaTerritorio: a.encaixe === 'dentro' ? a.tema_territorio || null : null,
      angulo: a.encaixe === 'dentro' ? a.angulo || null : null,
      radarTema: a.encaixe === 'radar' ? (a.radar_tema || a.tema || '').trim().toLowerCase() || null : null,
      confianca: a.confianca,
      motivo: a.motivo,
      territorioVersao: versaoEncaixe(p.territorioVersao),
      modelo,
      createdAt: new Date(),
    }
    await db
      .insert(encaixe)
      .values({ personaId: p.id, postId: row.id, source: 'llm', ...valores })
      .onConflictDoUpdate({ target: [encaixe.personaId, encaixe.postId, encaixe.source], set: valores })
    r.gravados++
  }
  return r
}

/** Sua correcao do encaixe de um post. null apaga a correcao. */
export async function corrigirEncaixe(personaId: string, shortcode: string, valor: string | null, radarTema?: string | null): Promise<boolean> {
  const [row] = await all<{ id: string }>(sql`select id from post where shortcode = ${shortcode} limit 1`)
  if (!row) return false
  await db.delete(encaixe).where(and(eq(encaixe.personaId, personaId), eq(encaixe.postId, row.id), eq(encaixe.source, 'humano')))
  if (valor) {
    await db.insert(encaixe).values({ personaId, postId: row.id, source: 'humano', encaixe: valor, radarTema: valor === 'radar' ? (radarTema ?? null) : null })
  }
  return true
}

/* ------------------------------------------------------------ execucao */

export interface RodadaSummary {
  tipo: TipoTarefa
  lotes: number
  gravados: number
  invalidos: number
  desconhecidos: number
  motivo?: string
  extra?: Record<string, unknown>
}

/** Salva a resposta que nao deu para ler, para conferir depois. */
function guardarResposta(tipo: string, texto: string): string {
  try {
    const dir = resolve(process.cwd(), 'data', 'debug')
    mkdirSync(dir, { recursive: true })
    const arq = join(dir, `ia-${tipo}-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`)
    writeFileSync(arq, texto, 'utf8')
    return arq
  } catch {
    return '(não salvei)'
  }
}

/** Monta, pergunta pela API e aplica, lote a lote, ate acabar ou bater o teto. */
export async function rodarTarefa(
  tipo: Exclude<TipoTarefa, 'pauta'>,
  opts: { personaId?: string; maxLotes?: number; refazer?: boolean; /** so estas contas */ so?: string[] } = {},
): Promise<RodadaSummary> {
  if (!temApi()) throw new Error('sem ANTHROPIC_API_KEY no .env: use o fluxo manual do painel (copiar prompt / colar resposta)')
  const s: RodadaSummary = { tipo, lotes: 0, gravados: 0, invalidos: 0, desconhecidos: 0 }
  // sem teto pratico: vai ate avaliar tudo (para quando o lote vem vazio ou a IA nao grava nada)
  const maxLotes = tipo === 'territorio' ? 1 : (opts.maxLotes ?? 500)
  const cheio = tipo === 'contas' ? 10 : 20
  let tamanho = cheio
  for (let i = 0; i < maxLotes; i++) {
    if (isStopRequested()) break
    const p = await exigirPersona(opts.personaId)
    const m = tipo === 'territorio' ? montarTerritorio(p) : tipo === 'contas' ? await montarContas(p, tamanho, opts.refazer && i === 0, opts.so, true) : await montarEncaixe(p, tamanho, opts.refazer && i === 0, opts.so, true)
    if (m.itens === 0) {
      if (i === 0) s.motivo = m.motivo
      break
    }
    logger.info({ tipo, lote: i + 1, itens: m.itens }, 'perguntando para a IA')
    const { texto, modelo } = await perguntarLlm(m.prompt, { imagens: m.imagens })
    let a: Aplicacao
    try {
      a = await aplicar(tipo, p, texto, modelo)
    } catch (error) {
      // resposta ilegivel: guarda para conferir e tenta o mesmo lote menor, em vez de derrubar a rodada
      const arquivo = guardarResposta(tipo, texto)
      const erro = error instanceof Error ? error.message : String(error)
      if (tipo !== 'territorio' && tamanho > 5) {
        tamanho = Math.max(5, Math.floor(tamanho / 2))
        logger.warn({ tipo, lote: i + 1, erro, resposta: arquivo, proximoLote: tamanho }, 'a IA respondeu fora do formato; tentando o lote menor')
        continue
      }
      logger.warn({ tipo, lote: i + 1, erro, resposta: arquivo }, 'a IA respondeu fora do formato de novo; parando aqui (o que já foi avaliado ficou gravado)')
      s.motivo = `${s.gravados} avaliados em ${s.lotes} lotes; parou no lote ${i + 1} porque a IA respondeu fora do formato (resposta em ${arquivo}). Rode de novo para continuar.`
      break
    }
    tamanho = cheio
    s.lotes++
    s.gravados += a.gravados
    s.invalidos += a.invalidos.length
    s.desconhecidos += a.desconhecidos.length
    s.extra = { ...s.extra, ...a.extra }
    if (a.invalidos.length) logger.warn({ invalidos: a.invalidos.slice(0, 5) }, 'itens fora do formato')
    // a IA nao gravou nada do lote: parar em vez de repetir o mesmo prompt
    if (a.gravados === 0) break
    if (opts.refazer) break
  }
  return s
}

export async function aplicar(tipo: Exclude<TipoTarefa, 'pauta'>, p: Persona, texto: string, modelo: string): Promise<Aplicacao> {
  if (tipo === 'territorio') return aplicarTerritorio(p, texto)
  if (tipo === 'contas') return aplicarContas(p, texto, modelo)
  return aplicarEncaixe(p, texto, modelo)
}
