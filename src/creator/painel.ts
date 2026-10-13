import { sql } from 'drizzle-orm'
import { all, comoJson } from '../db/client'
import { config } from '../shared/config'
import { localDayKey } from '../shared/time'
import { consumidos, encaixesDe, historicoEngajamento, postsJanela, sementesPorAutor, versaoEncaixe } from './dados'
import { desempenhoRelativo } from './score'
import { contasDoGrafo, minimoSementes, type ContaGrafo } from './grafo'
import { temApi, modeloCreator, modeloPauta } from './llm'
import { semanaDe, porQueDe, pontuados } from './pauta'
import { listarPersonas, listarSementes, personaAtiva, getPersona, territorioDe, type Persona } from './persona'
import { MOTIVOS_RECUSA, PERGUNTAS } from './tipos'
import { limparSugeridasQueSaoReferencia, listarReferencias, moverCreatorsParaReferencia } from './referencias'

export interface PostMini {
  shortcode: string
  autor: string
  tipo: string | null
  thumb: string | null
  legenda: string
  likes: number | null
  comments: number | null
  takenAt: number | null
}

async function postsMini(ids: string[]): Promise<Map<string, PostMini>> {
  const m = new Map<string, PostMini>()
  if (ids.length === 0) return m
  const rows = await all<PostMini & { id: string }>(sql`
    select p.id, p.shortcode, lower(a.username) as autor, p.media_type as tipo, coalesce(p.caption, '') as legenda, p.taken_at as "takenAt",
      (select '/media/' || ma.id from media_asset ma where ma.post_id = p.id and ma.kind = 'image' and ma.position = 0 and ma.local_path is not null limit 1) as thumb,
      (select m.like_count from post_metric m where m.post_id = p.id order by m.captured_at desc limit 1) as likes,
      (select m.comment_count from post_metric m where m.post_id = p.id order by m.captured_at desc limit 1) as comments
    from post p left join author a on a.id = p.author_id
    where p.id in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})
  `)
  for (const r of rows) m.set(r.id, { ...r, legenda: r.legenda.slice(0, 400) })
  return m
}

export interface IdeiaPainel {
  id: string
  tipo: string
  ordem: number
  titulo: string
  porQue: string | null
  angulo: string | null
  hook: string | null
  formato: string | null
  status: string
  motivo: string | null
  nota: string | null
  score: number | null
  /** quando a ideia foi gerada (segundos) */
  createdAt: number
  /** versoes de roteiro geradas para a ideia */
  roteiros: number
  posts: PostMini[]
}

function resumoPersona(p: Persona) {
  return { id: p.id, nome: p.nome, handle: p.handle, ativa: p.ativa, temTerritorio: Boolean(p.territorio) }
}

/** Tudo o que as abas Pauta, Creator e Sementes mostram, de uma vez. */
export async function loadCreator(personaId?: string | null, semanaPedida?: string | null, vista: { visao?: string | null; dia?: string | null } = {}) {
  const personas = await listarPersonas()
  const p = personaId ? await getPersona(personaId) : await personaAtiva()
  const base = {
    personas: personas.map(resumoPersona),
    perguntas: PERGUNTAS,
    motivosRecusa: MOTIVOS_RECUSA,
    api: { chave: temApi(), modelo: modeloCreator(), modeloPauta: modeloPauta() },
    semanaAtual: semanaDe(),
  }
  if (!p) return { ...base, persona: null }

  await moverCreatorsParaReferencia(p.id)
  await limparSugeridasQueSaoReferencia(p.id)
  const sementes = await listarSementes(p.id)
  const listas = new Map(
    (await all<{ s: string; n: number }>(sql`select semente as s, count(*) as n from seguindo group by semente`)).map((r) => [r.s, r.n]),
  )
  const comLista = sementes.filter((s) => s.status === 'confirmada' && (listas.get(s.username) ?? 0) > 0).length
  const grafo: ContaGrafo[] = await contasDoGrafo(p.id)

  const semanas = (await all<{ s: string }>(sql`select distinct semana as s from ideia where persona_id = ${p.id} order by semana desc`))
    .map((r) => r.s)
  // por dia (data local de quando a ideia foi gerada) ou por semana ISO
  const porDia = vista.visao === 'dia'
  // dia no fuso do creator (o Postgres do Supabase roda em UTC)
  const diaLocal = sql`to_char(to_timestamp(created_at) at time zone ${config.TZ_NAME}, 'YYYY-MM-DD')`
  const hoje = localDayKey()
  const dias = (await all<{ d: string }>(sql`select distinct ${diaLocal} as d from ideia where persona_id = ${p.id} and tipo = 'pauta' order by d desc limit 90`))
    .map((r) => r.d)
  const dia = vista.dia && /^\d{4}-\d{2}-\d{2}$/.test(vista.dia) ? vista.dia : dias[0] || hoje
  const semana = porDia ? semanaDe(new Date(`${dia}T12:00:00`)) : semanaPedida || semanas[0] || semanaDe()
  const ideiasRows = await all<{
    id: string
    tipo: string
    ordem: number
    titulo: string
    porQue: string | null
    angulo: string | null
    hook: string | null
    formato: string | null
    status: string
    motivo: string | null
    nota: string | null
    score: number | null
    roteiros: number
    createdAt: number
    evidencias: string
  }>(sql`
    select id, tipo, ordem, titulo, por_que as "porQue", angulo, hook, formato, status, motivo, nota, score, evidencias,
      (select count(*) from roteiro r where r.ideia_id = ideia.id) as roteiros, created_at as "createdAt"
    from ideia where persona_id = ${p.id}
      ${porDia ? sql`and ((tipo = 'pauta' and ${diaLocal} = ${dia}) or (tipo = 'radar' and semana = ${semana}))` : sql`and semana = ${semana}`}
    order by tipo, ${porDia ? sql`created_at desc, ordem` : sql`ordem`}
  `)
  const evid = ideiasRows.map((r) => ({ r, ids: comoJson<string[]>(r.evidencias, []).filter(Boolean) }))
  const mini = await postsMini([...new Set(evid.flatMap((e) => e.ids))])
  const ideias: IdeiaPainel[] = evid.map(({ r, ids }) => {
    const { evidencias: _e, ...resto } = r
    return { ...resto, posts: ids.map((i) => mini.get(i)).filter((x): x is PostMini => Boolean(x)) }
  })

  // o funil do ciclo semanal, para saber onde parou
  const cons = await consumidos(p.id)
  const janela = await postsJanela(p.id)
  const enc = await encaixesDe(p.id)
  const avaliados = janela.filter((x) => {
    const e = enc.get(x.id)
    return e && (e.source === 'humano' || e.versaoLlm === versaoEncaixe(p.territorioVersao))
  })
  const contagem = (v: string) => janela.filter((x) => enc.get(x.id)?.encaixe === v).length
  const { total } = await sementesPorAutor(p.id)

  // o melhor que ha agora, antes mesmo da pauta: ajuda a revisar o encaixe
  const { dentro, radar } = await pontuados(p.id, semana)
  const topo = (xs: typeof dentro) =>
    xs.slice(0, 30).map((c) => ({
      shortcode: c.post.shortcode,
      autor: c.autor,
      thumb: c.post.thumb,
      legenda: (c.post.caption ?? '').slice(0, 300),
      tema: c.tema,
      temaTerritorio: c.temaTerritorio,
      angulo: c.angulo,
      radarTema: c.radarTema,
      score: c.score,
      porQue: porQueDe(c, total),
    }))

  const refsRows = await listarReferencias(p.id)
  const refsInfo = new Map(
    (await all<{ u: string; fullName: string | null; bio: string | null; followers: number | null; lastWatchedAt: number | null; posts: number; dentro: number }>(sql`
        select lower(a.username) as u, a.full_name as "fullName", a.biography as bio, a.followers_count as followers,
          a.last_watched_at as "lastWatchedAt",
          (select count(*) from post x where x.author_id = a.id) as posts,
          (select count(*) from post x join encaixe e on e.post_id = x.id
            where x.author_id = a.id and e.persona_id = ${p.id} and e.encaixe = 'dentro') as dentro
        from author a where lower(a.username) in (select username from referencia where persona_id = ${p.id})
      `))
      .map((r) => [r.u, r]),
  )
  const referencias = refsRows.map((r) => {
    const i = refsInfo.get(r.username)
    return {
      username: r.username,
      status: r.status,
      origem: r.origem,
      motivo: r.motivo,
      fullName: i?.fullName ?? null,
      bio: i?.bio ?? null,
      followers: i?.followers ?? null,
      lastWatchedAt: i?.lastWatchedAt ?? null,
      posts: i?.posts ?? 0,
      dentro: i?.dentro ?? 0,
    }
  })

  return {
    ...base,
    referencias,
    persona: { ...resumoPersona(p), entrevista: p.entrevista, territorio: territorioDe(p), territorioVersao: p.territorioVersao, publico: p.publico },
    sementes: sementes.map((s) => ({
      username: s.username,
      status: s.status,
      origem: s.origem,
      motivo: s.motivo,
      fullName: s.fullName,
      bio: s.biography,
      followingCount: s.followingCount,
      privada: s.privada,
      coletadaEm: s.coletadaEm ? Math.floor(s.coletadaEm.getTime() / 1000) : null,
      tentativaEm: s.tentativaEm ? Math.floor(s.tentativaEm.getTime() / 1000) : null,
      erro: s.erro,
      contas: listas.get(s.username) ?? 0,
    })),
    grafo,
    minimo: minimoSementes(comLista),
    semanas: semanas.includes(semanaDe()) ? semanas : [semanaDe(), ...semanas],
    semana,
    visao: porDia ? 'dia' : 'semana',
    dia,
    hoje,
    dias: dias.includes(hoje) ? dias : [hoje, ...dias],
    ideias,
    melhores: { dentro: topo(dentro), radar: topo(radar) },
    funil: {
      sementes: sementes.filter((s) => s.status === 'confirmada').length,
      sugeridas: sementes.filter((s) => s.status === 'sugerida').length,
      comLista,
      contasGrafo: grafo.length,
      visitadas: grafo.filter((g) => g.lastWatchedAt).length,
      consumidas: cons.length,
      referencias: refsRows.filter((r) => r.status === 'ativa').length,
      postsJanela: janela.length,
      avaliados: avaliados.length,
      dentro: contagem('dentro'),
      radar: contagem('radar'),
      fora: contagem('fora'),
      janelaDias: config.JANELA_DIAS,
    },
  }
}

/* ------------------------------------------------------------ detalhe de uma ideia */

export interface PostDetalhe {
  shortcode: string
  autor: string
  autorNome: string | null
  autorBio: string | null
  autorCategoria: string | null
  verificado: boolean
  seguidores: number | null
  tipo: string | null
  legenda: string
  takenAt: number | null
  likes: number | null
  comments: number | null
  plays: number | null
  duracao: number | null
  slides: number
  audio: string | null
  local: string | null
  hashtags: string[]
  /** descricao automatica que o Instagram gera para a imagem */
  alt: string | null
  /** transcricoes por fonte: legenda automatica do Instagram e/ou whisper local */
  transcricoes: { fonte: string; texto: string }[]
  /** o video foi transcrito e nao tem fala (musica, silencio) */
  semFala: boolean
  midias: { imagem: string | null; video: string | null }[]
  features: { gancho: string | null; primeiraLinha: string | null; cta: string | null; diaSemana: string | null; hora: number | null; publi: boolean | null } | null
  /** curtidas+comentarios divididos pela mediana do autor (1 = normal) */
  desempenho: number | null
  postsDoAutor: number
  sementes: number
  totalSementes: number
  encaixe: { encaixe: string; tema: string | null; temaTerritorio: string | null; angulo: string | null; motivo: string | null; confianca: number | null } | null
}

async function postDetalhe(postId: string, personaId: string, sem: { total: number; mapa: Map<string, number> }): Promise<PostDetalhe | null> {
  const [r] = await all<{
    shortcode: string
    autor: string
    autorNome: string | null
    autorBio: string | null
    autorCategoria: string | null
    verificado: boolean | null
    seguidores: number | null
    tipo: string | null
    legenda: string
    takenAt: number | null
    likes: number | null
    comments: number | null
    plays: number | null
    duracao: number | null
    audio: string | null
    local: string | null
    hashtags: string | null
  }>(sql`
    select p.shortcode, lower(a.username) as autor, a.full_name as "autorNome", a.biography as "autorBio", a.category as "autorCategoria",
      a.is_verified as verificado, a.followers_count as seguidores,
      p.media_type as tipo, coalesce(p.caption, '') as legenda, p.taken_at as "takenAt", p.audio_title as audio, p.location_name as local,
      (select m.like_count from post_metric m where m.post_id = p.id order by m.captured_at desc limit 1) as likes,
      (select m.comment_count from post_metric m where m.post_id = p.id order by m.captured_at desc limit 1) as comments,
      (select m.play_count from post_metric m where m.post_id = p.id order by m.captured_at desc limit 1) as plays,
      (select max(ma.duration_s) from media_asset ma where ma.post_id = p.id and ma.kind = 'video') as duracao,
      (select string_agg(h.tag, ' ') from post_hashtag ph join hashtag h on h.id = ph.hashtag_id where ph.post_id = p.id) as hashtags
    from post p left join author a on a.id = p.author_id where p.id = ${postId}
  `)
  if (!r) return null

  const assets = await all<{ id: string; kind: string; position: number }>(sql`
    select id, kind, position from media_asset where post_id = ${postId} and local_path is not null and kind in ('image', 'video') order by position
  `)
  const porPos = new Map<number, { imagem: string | null; video: string | null }>()
  for (const a of assets) {
    const m = porPos.get(a.position) ?? { imagem: null, video: null }
    if (a.kind === 'video') m.video = `/media/${a.id}`
    else m.imagem = `/media/${a.id}`
    porPos.set(a.position, m)
  }

  const enr = await all<{ kind: string; model: string; output: string }>(sql`
    select kind, model, output from enrichment where post_id = ${postId} and kind in ('transcript', 'alt_text', 'features')
  `)
  const json = (t: unknown): Record<string, unknown> => comoJson<Record<string, unknown>>(t, {})
  const transcricoes: { fonte: string; texto: string }[] = []
  let semFala = false
  let alt: string | null = null
  let feats: Record<string, unknown> | null = null
  for (const e of enr) {
    const o = json(e.output)
    if (e.kind === 'transcript') {
      const texto = typeof o['text'] === 'string' ? o['text'].trim() : ''
      if (texto) transcricoes.push({ fonte: e.model.startsWith('whisper') ? 'Whisper (transcrição local)' : 'Legenda automática do Instagram', texto })
      else if (o['semFala'] === true) semFala = true
    } else if (e.kind === 'alt_text' && typeof o['text'] === 'string') alt = o['text']
    else if (e.kind === 'features' && e.model === 'deterministic') feats = o
  }
  const str = (v: unknown) => (typeof v === 'string' && v ? v : null)

  const hist = (await historicoEngajamento([r.autor])).get(r.autor) ?? []
  const desempenho = r.likes === null || hist.length < 3 ? null : desempenhoRelativo(r.likes + (r.comments ?? 0), hist)
  const enc = (await encaixesDe(personaId)).get(postId)
  return {
    shortcode: r.shortcode,
    autor: r.autor,
    autorNome: r.autorNome,
    autorBio: r.autorBio,
    autorCategoria: r.autorCategoria,
    verificado: r.verificado === true,
    seguidores: r.seguidores,
    tipo: r.tipo,
    legenda: r.legenda,
    takenAt: r.takenAt,
    likes: r.likes,
    comments: r.comments,
    plays: r.plays,
    duracao: r.duracao,
    slides: [...porPos.values()].length,
    audio: r.audio,
    local: r.local,
    hashtags: r.hashtags ? r.hashtags.split(' ').filter(Boolean) : [],
    alt,
    transcricoes,
    semFala,
    midias: [...porPos.entries()].sort((a, b) => a[0] - b[0]).map(([, m]) => m),
    features: feats
      ? {
          gancho: str(feats['hookType']),
          primeiraLinha: str(feats['firstLine']),
          cta: str(feats['ctaType']),
          diaSemana: str(feats['weekday']),
          hora: typeof feats['hour'] === 'number' ? (feats['hour'] as number) : null,
          publi: typeof feats['isPaidPartnership'] === 'boolean' ? (feats['isPaidPartnership'] as boolean) : null,
        }
      : null,
    desempenho,
    postsDoAutor: hist.length,
    sementes: sem.mapa.get(r.autor) ?? 0,
    totalSementes: sem.total,
    encaixe: enc
      ? { encaixe: enc.encaixe, tema: enc.tema, temaTerritorio: enc.temaTerritorio, angulo: enc.angulo, motivo: enc.motivo, confianca: enc.confianca }
      : null,
  }
}

/** Tudo sobre uma ideia: o texto, o post do assunto e o post do formato, por inteiro. */
export async function detalheIdeia(id: string) {
  const [i] = await all<{
    id: string
    personaId: string
    semana: string
    tipo: string
    titulo: string
    porQue: string | null
    angulo: string | null
    hook: string | null
    formato: string | null
    status: string
    motivo: string | null
    nota: string | null
    score: number | null
    evidencias: string
    modelo: string | null
    createdAt: number
  }>(sql`
    select id, persona_id as "personaId", semana, tipo, titulo, por_que as "porQue", angulo, hook, formato, status, motivo, nota,
      score, evidencias, modelo, created_at as "createdAt"
    from ideia where id = ${id}
  `)
  if (!i) return null
  const ev = comoJson<string[]>(i.evidencias, []).filter(Boolean)
  const sem = await sementesPorAutor(i.personaId)
  const posts = (await Promise.all(ev.map((pid) => postDetalhe(pid, i.personaId, sem)))).filter((x): x is PostDetalhe => Boolean(x))
  const { evidencias: _e, ...resto } = i
  return {
    ...resto,
    assunto: i.tipo === 'pauta' ? (posts[0] ?? null) : null,
    formatoRef: i.tipo === 'pauta' ? (posts[1] ?? null) : null,
    exemplos: i.tipo === 'radar' ? posts : [],
  }
}
