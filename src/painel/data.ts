import { sql } from 'drizzle-orm'
import { db } from '../db/client'

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
  /** url local da capa, servida pelo proprio painel */
  thumb: string | null
  /** todos os slides baixados, em ordem; slide de video traz o video e a capa dele */
  media: PainelSlide[]
}

export interface PainelSlide {
  position: number
  image: string | null
  video: string | null
}

export interface PainelRun {
  kind: string
  status: string
  started_at: number | null
  ended_at: number | null
  cards_seen: number
  cards_new: number
}

export interface PainelData {
  generatedAt: number
  posts: PainelPost[]
  runs: PainelRun[]
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
    where p.discovery_source = 'explore'
  `)

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
      trWhisper: str(whisper?.['text']),
      thumb: r.coverId ? `/media/${encodeURIComponent(r.coverId)}` : null,
      media: [...(slidesPorPost.get(r.id)?.values() ?? [])].sort((x, y) => x.position - y.position),
    }
  })

  const runs = await db.all<PainelRun>(sql`
    select kind, status, started_at, ended_at, cards_seen, cards_new
    from collection_run order by started_at
  `)

  return { generatedAt: Math.floor(Date.now() / 1000), posts, runs }
}

/** Caminho do arquivo de um asset. Busca por id, nunca por caminho vindo da URL. */
export async function mediaPath(id: string): Promise<string | null> {
  const rows = await db.all<{ path: string | null }>(sql`
    select local_path as path from media_asset where id = ${id} limit 1
  `)
  return rows[0]?.path ?? null
}
