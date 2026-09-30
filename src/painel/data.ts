import { sql } from 'drizzle-orm'
import { db } from '../db/client'
import { detectLang, type Lang } from '../parser/lang'
import { loadTerms, pickNext, termStatus } from '../collector/terms'

export interface PainelPost {
  shortcode: string
  username: string | null
  fullName: string | null
  followers: number | null
  verified: boolean | null
  type: string | null
  caption: string
  takenAt: number | null
  seenAt: number | null
  likes: number | null
  comments: number | null
  plays: number | null
  hook: string | null
  cta: string | null
  firstLine: string | null
  weekday: string | null
  hour: number | null
  tags: string[]
  audio: string | null
  location: string | null
  slides: number
  duration: number | null
  alt: string | null
  trIg: string | null
  trWhisper: string | null
  /** o whisper rodou e nao achou fala (musica, silencio ou sem audio) */
  semFala: boolean
  /** url local da capa, servida pelo proprio painel */
  thumb: string | null
  /** todos os slides baixados, em ordem; slide de video traz o video e a capa dele */
  media: PainelSlide[]
  /** idioma da legenda, estimado sem modelo */
  lang: Lang
  /** apareceu no Explorar */
  explore: boolean
  /** termos de busca em que apareceu, com a melhor posicao em cada um */
  terms: { term: string; position: number | null }[]
  /** cada vez que o post apareceu: quando, onde, em qual termo e posicao */
  hits: PainelHit[]
  /** avaliacao da LLM e sua correcao (a correcao vale sobre a LLM) */
  ia: Record<string, unknown> | null
  iaHumano: string | null
}

export interface PainelAuthor {
  username: string
  fullName: string | null
  followers: number | null
  verified: boolean | null
  bio: string | null
  /** categoria da conta no Instagram */
  category: string | null
  /** avaliacao da LLM ({ classe, confianca, motivo, sinais }) e sua correcao */
  ia: (Record<string, unknown> & { modelo?: string | null; em?: number }) | null
  iaHumano: string | null
  /** acompanhar | ignorar | null */
  watch: string | null
  /** quem marcou: voce | ia */
  watchSource: string | null
  /** se a IA escolheu esta conta na rodada de selecao: posicao e motivo */
  selecao: Record<string, unknown> | null
  lastWatchedAt: number | null
}

export interface PainelHit {
  /** explore | search */
  s: string
  term: string | null
  pos: number | null
  /** unix segundos */
  at: number
  run: string | null
}

export interface PainelSlide {
  position: number
  image: string | null
  video: string | null
}

export interface PainelRun {
  id: string
  kind: string
  term: string | null
  day_key: string
  status: string
  started_at: number | null
  ended_at: number | null
  cards_seen: number
  cards_new: number
  responses_captured: number
  abort_reason: string | null
}

export interface PainelTerm {
  termo: string
  buscas: number
  ultima: number | null
  proximo: boolean
}

export interface PainelData {
  generatedAt: number
  posts: PainelPost[]
  runs: PainelRun[]
  terms: PainelTerm[]
  authors: PainelAuthor[]
}

interface PostRow {
  id: string
  shortcode: string
  type: string | null
  caption: string | null
  takenAt: number | null
  seenAt: number | null
  audio: string | null
  location: string | null
  username: string | null
  fullName: string | null
  followers: number | null
  verified: number | null
  likes: number | null
  comments: number | null
  plays: number | null
  coverId: string | null
  slides: number | null
  duration: number | null
  tags: string | null
}

interface EnrichmentRow {
  postId: string
  kind: string
  model: string
  output: string
}

function parse(json: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(json)
    return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)
const int = (v: unknown): number | null => (typeof v === 'number' ? v : null)

/** Le o banco inteiro no formato que a interface espera. Poucas consultas, nao uma por post. */
export async function loadPainel(): Promise<PainelData> {
  const rows = await db.all<PostRow>(sql`
    select
      p.id, p.shortcode, p.media_type as type, p.caption,
      p.taken_at as takenAt, p.first_seen_at as seenAt,
      p.audio_title as audio, p.location_name as location,
      a.username, a.full_name as fullName, a.followers_count as followers, a.is_verified as verified,
      (select m.like_count from post_metric m where m.post_id = p.id order by m.captured_at desc limit 1) as likes,
      (select m.comment_count from post_metric m where m.post_id = p.id order by m.captured_at desc limit 1) as comments,
      (select m.play_count from post_metric m where m.post_id = p.id order by m.captured_at desc limit 1) as plays,
      (select ma.id from media_asset ma
        where ma.post_id = p.id and ma.kind = 'image' and ma.position = 0 and ma.local_path is not null
        limit 1) as coverId,
      (select count(distinct ma.position) from media_asset ma where ma.post_id = p.id and ma.kind = 'image') as slides,
      (select ma.duration_s from media_asset ma
        where ma.post_id = p.id and ma.kind = 'video' order by ma.position limit 1) as duration,
      (select group_concat(h.tag, ' ') from post_hashtag ph
        join hashtag h on h.id = ph.hashtag_id where ph.post_id = p.id) as tags
    from post p
    left join author a on a.id = p.author_id
    where p.discovery_source in ('explore', 'search', 'profile')
  `)

  const aparicoes = await db.all<{ postId: string; source: string; term: string | null; position: number | null; at: number; run: string | null }>(sql`
    select post_id as postId, source, term, position, seen_at as at, run_id as run
    from discovery order by seen_at
  `)
  const origens = new Map<string, { explore: boolean; terms: Map<string, number | null>; hits: PainelHit[] }>()
  for (const a of aparicoes) {
    const o = origens.get(a.postId) ?? { explore: false, terms: new Map<string, number | null>(), hits: [] }
    o.hits.push({ s: a.source, term: a.term, pos: a.position, at: a.at, run: a.run })
    if (a.source === 'explore') o.explore = true
    else if (a.source === 'search' && a.term) {
      const atual = o.terms.get(a.term)
      if (atual === undefined || (a.position !== null && (atual === null || a.position < atual))) o.terms.set(a.term, a.position)
    }
    origens.set(a.postId, o)
  }

  const enrichments = await db.all<EnrichmentRow>(sql`
    select post_id as postId, kind, model, output from enrichment
    where kind in ('features', 'alt_text', 'transcript')
  `)

  const assets = await db.all<{ postId: string; id: string; position: number; kind: string }>(sql`
    select post_id as postId, id, position, kind from media_asset
    where local_path is not null and kind in ('image', 'video')
    order by position
  `)
  const slidesPorPost = new Map<string, Map<number, PainelSlide>>()
  for (const a of assets) {
    const slides = slidesPorPost.get(a.postId) ?? new Map<number, PainelSlide>()
    const slide = slides.get(a.position) ?? { position: a.position, image: null, video: null }
    const url = `/media/${encodeURIComponent(a.id)}`
    if (a.kind === 'video') slide.video = url
    else slide.image = url
    slides.set(a.position, slide)
    slidesPorPost.set(a.postId, slides)
  }

  const porPost = new Map<string, Map<string, Record<string, unknown>>>()
  for (const e of enrichments) {
    const mapa = porPost.get(e.postId) ?? new Map<string, Record<string, unknown>>()
    mapa.set(`${e.kind}|${e.model}`, parse(e.output))
    porPost.set(e.postId, mapa)
  }

  // avaliacoes: a da LLM e a sua correcao, por alvo
  const avals = await db.all<{ type: string; target: string; source: string; model: string | null; output: string; at: number }>(sql`
    select target_type as type, target_id as target, source, model, output, created_at as at from classification
  `)
  const iaLlm = new Map<string, Record<string, unknown>>()
  const iaHum = new Map<string, Record<string, unknown>>()
  const iaSel = new Map<string, Record<string, unknown>>()
  for (const a of avals) {
    const out = { ...parse(a.output), modelo: a.model, em: a.at }
    if (a.source === 'selecao') iaSel.set(`${a.type}:${a.target}`, out)
    else (a.source === 'humano' ? iaHum : iaLlm).set(`${a.type}:${a.target}`, out)
  }

  const posts: PainelPost[] = rows.map((r) => {
    const e = porPost.get(r.id) ?? new Map<string, Record<string, unknown>>()
    const f = e.get('features|deterministic') ?? {}
    const whisper = [...e.entries()].find(([k]) => k.startsWith('transcript|whisper:'))?.[1]

    return {
      shortcode: r.shortcode,
      username: r.username,
      fullName: r.fullName,
      followers: r.followers,
      verified: r.verified === null ? null : r.verified === 1,
      type: r.type,
      caption: r.caption ?? '',
      takenAt: r.takenAt,
      seenAt: r.seenAt,
      likes: r.likes,
      comments: r.comments,
      plays: r.plays,
      hook: str(f['hookType']),
      cta: str(f['ctaType']),
      firstLine: str(f['firstLine']),
      weekday: str(f['weekday']),
      hour: int(f['hour']),
      tags: r.tags ? r.tags.split(' ').filter(Boolean) : [],
      audio: r.audio,
      location: r.location,
      slides: r.slides ?? 0,
      duration: r.duration,
      alt: str(e.get('alt_text|instagram')?.['text']),
      trIg: str(e.get('transcript|instagram')?.['text']),
      trWhisper: str(whisper?.['text']) || null,
      semFala: whisper?.['semFala'] === true,
      thumb: r.coverId ? `/media/${encodeURIComponent(r.coverId)}` : null,
      media: [...(slidesPorPost.get(r.id)?.values() ?? [])].sort((x, y) => x.position - y.position),
      lang: detectLang(r.caption),
      // post antigo, de antes da tabela discovery, veio do Explorar
      explore: origens.get(r.id)?.explore ?? !origens.has(r.id),
      terms: [...(origens.get(r.id)?.terms.entries() ?? [])].map(([term, position]) => ({ term, position })),
      // post de antes da tabela discovery: a unica data que temos e a da primeira captura
      ia: iaLlm.get(`post:${r.id}`) ?? null,
      iaHumano: str(iaHum.get(`post:${r.id}`)?.['relevancia']),
      hits: origens.get(r.id)?.hits ?? (r.seenAt ? [{ s: 'explore', term: null, pos: null, at: r.seenAt, run: null }] : []),
    }
  })

  const runs = await db.all<PainelRun>(sql`
    select id, kind, term, day_key, status, started_at, ended_at, cards_seen, cards_new,
      responses_captured, abort_reason
    from collection_run order by started_at desc
  `)

  const status = await termStatus(loadTerms())
  const proximo = pickNext(status)
  const terms: PainelTerm[] = status.map((t) => ({
    termo: t.termo,
    buscas: t.buscas,
    ultima: t.ultima ? Math.floor(t.ultima.getTime() / 1000) : null,
    proximo: t.termo === proximo,
  }))

  const autoresRows = await db.all<{
    username: string
    fullName: string | null
    followers: number | null
    verified: number | null
    bio: string | null
    category: string | null
    watch: string | null
    watchSource: string | null
    lastWatchedAt: number | null
    id: string
  }>(sql`
    select id, username, full_name as fullName, followers_count as followers, is_verified as verified,
      biography as bio, category, watch, watch_source as watchSource, last_watched_at as lastWatchedAt
    from author
  `)
  const legendas = new Map<string, string[]>()
  for (const p of posts) {
    if (!p.username) continue
    const l = legendas.get(p.username) ?? []
    if (p.caption) l.push(p.caption)
    legendas.set(p.username, l)
  }
  const authors: PainelAuthor[] = autoresRows
    .filter((a) => legendas.has(a.username) || a.watch)
    .map((a) => ({
      username: a.username,
      fullName: a.fullName,
      followers: a.followers,
      verified: a.verified === null ? null : a.verified === 1,
      bio: a.bio,
      watch: a.watch,
      lastWatchedAt: a.lastWatchedAt,
      category: a.category,
      ia: (iaLlm.get(`author:${a.id}`) as PainelAuthor['ia']) ?? null,
      iaHumano: str(iaHum.get(`author:${a.id}`)?.['classe']),
      watchSource: a.watchSource,
      selecao: iaSel.get(`author:${a.id}`) ?? null,
    }))

  return { generatedAt: Math.floor(Date.now() / 1000), posts, runs, terms, authors }
}

/** Caminho do arquivo de um asset. Busca por id, nunca por caminho vindo da URL. */
export async function mediaPath(id: string): Promise<string | null> {
  const rows = await db.all<{ path: string | null }>(sql`
    select local_path as path from media_asset where id = ${id} limit 1
  `)
  return rows[0]?.path ?? null
}
