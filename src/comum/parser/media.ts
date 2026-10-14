export interface ParsedAuthor {
  igUserId: string
  username: string
  fullName?: string
  isVerified?: boolean
  followersCount?: number
}

export interface ParsedAsset {
  position: number
  kind: 'image' | 'video' | 'subtitle'
  url: string
  width?: number
  height?: number
  durationS?: number
}

export interface ParsedMedia {
  shortcode: string
  igMediaId?: string
  mediaType?: string
  caption?: string
  takenAt?: Date
  likeCount?: number
  commentCount?: number
  playCount?: number
  likeCountHidden?: boolean
  audioId?: string
  audioTitle?: string
  locationName?: string
  hashtags: string[]
  author?: ParsedAuthor
  /** texto alternativo que o proprio Instagram gera; sinal barato e util */
  altText?: string
  assets: ParsedAsset[]
  /** campos crus que alimentam as features deterministicas */
  originalWidth?: number
  originalHeight?: number
  carouselCount?: number
  hasAudio?: boolean
  videoDurationS?: number
  isPaidPartnership?: boolean
  repostCount?: number
  usertagCount?: number
  /** legenda automatica que o proprio Instagram gera para reels (.srt) */
  subtitlesLocale?: string
}

const SHORTCODE_RE = /^[A-Za-z0-9_-]{8,20}$/
const HASHTAG_RE = /#([\p{L}\p{N}_]+)/gu
const MAX_NODES = 200_000

type Rec = Record<string, unknown>

function asRec(value: unknown): Rec | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Rec) : undefined
}

function asString(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  return undefined
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value)
  return undefined
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

/**
 * media_type e product_type vem juntos nos payloads reais:
 * 1=imagem, 2=video, 8=carrossel; product_type 'clips' e reel.
 */
function mediaTypeOf(node: Rec): string | undefined {
  if (node['product_type'] === 'clips') return 'reel'
  const mt = node['media_type']
  if (mt === 8 || node['product_type'] === 'carousel_container') return 'carousel'
  if (mt === 2) return 'video'
  if (mt === 1) return 'image'

  const typename = node['__typename']
  if (typename === 'GraphImage' || typename === 'XDTGraphImage') return 'image'
  if (typename === 'GraphVideo' || typename === 'XDTGraphVideo') return 'video'
  if (typename === 'GraphSidecar' || typename === 'XDTGraphSidecar') return 'carousel'
  return undefined
}

function captionOf(node: Rec): string | undefined {
  const caption = node['caption']
  if (typeof caption === 'string') return caption
  const rec = asRec(caption)
  const text = rec ? asString(rec['text']) : undefined
  if (text) return text

  // formato graphql antigo
  const edges = asRec(node['edge_media_to_caption'])?.['edges']
  if (Array.isArray(edges)) {
    const first = asRec(edges[0])
    const inner = first ? asRec(first['node']) : undefined
    return inner ? asString(inner['text']) : undefined
  }
  return undefined
}

function hashtagsOf(caption: string | undefined): string[] {
  if (!caption) return []
  const found = new Set<string>()
  for (const match of caption.matchAll(HASHTAG_RE)) {
    const tag = match[1]?.toLowerCase()
    if (tag) found.add(tag)
  }
  return [...found]
}

function authorOf(node: Rec): ParsedAuthor | undefined {
  const user = asRec(node['user']) ?? asRec(node['owner'])
  if (!user) return undefined

  const igUserId = asString(user['pk']) ?? asString(user['id']) ?? asString(user['pk_id'])
  const username = asString(user['username'])
  if (!igUserId || !username) return undefined

  return {
    igUserId,
    username,
    fullName: asString(user['full_name']),
    isVerified: asBoolean(user['is_verified']),
    // costuma vir ausente no grid; so preenche quando existir de verdade
    followersCount: asNumber(user['follower_count']) ?? asNumber(user['edge_followed_by']),
  }
}

/**
 * candidates vem ordenado do maior para o menor. Para visao, largura media
 * basta e custa muito menos token que 1080px.
 */
function pickCandidate(candidates: unknown, targetWidth: number): Rec | undefined {
  if (!Array.isArray(candidates)) return undefined
  const usable = candidates.map(asRec).filter((c): c is Rec => c !== undefined && typeof c['url'] === 'string')
  if (usable.length === 0) return undefined

  const atLeastTarget = usable.filter((c) => (asNumber(c['width']) ?? 0) >= targetWidth)
  if (atLeastTarget.length > 0) {
    return atLeastTarget.reduce((best, c) =>
      (asNumber(c['width']) ?? 0) < (asNumber(best['width']) ?? 0) ? c : best,
    )
  }
  return usable.reduce((best, c) => ((asNumber(c['width']) ?? 0) > (asNumber(best['width']) ?? 0) ? c : best))
}

function assetsOfNode(node: Rec, position: number, targetWidth: number): ParsedAsset[] {
  const out: ParsedAsset[] = []

  const image = pickCandidate(asRec(node['image_versions2'])?.['candidates'], targetWidth)
  const imageUrl = image ? asString(image['url']) : undefined
  if (imageUrl) {
    out.push({
      position,
      kind: 'image',
      url: imageUrl,
      width: asNumber(image?.['width']),
      height: asNumber(image?.['height']),
    })
  }

  /**
   * O Instagram transcreve os reels sozinho e entrega um .srt assinado.
   * E transcricao de graca — so existe para parte dos reels e a URL expira
   * como a das imagens, entao tem que baixar logo apos a coleta.
   */
  const subtitles = asString(node['video_subtitles_uri'])
  if (subtitles) {
    out.push({ position, kind: 'subtitle', url: subtitles })
  }

  const video = pickCandidate(node['video_versions'], targetWidth)
  const videoUrl = video ? asString(video['url']) : undefined
  if (videoUrl) {
    out.push({
      position,
      kind: 'video',
      url: videoUrl,
      width: asNumber(video?.['width']),
      height: asNumber(video?.['height']),
      durationS: asNumber(node['video_duration']),
    })
  }

  return out
}

/** Carrossel rende um asset por filho; o resto rende um so. */
function assetsOf(node: Rec, targetWidth: number): ParsedAsset[] {
  const carousel = node['carousel_media']
  if (Array.isArray(carousel) && carousel.length > 0) {
    return carousel.flatMap((child, index) => {
      const rec = asRec(child)
      return rec ? assetsOfNode(rec, index, targetWidth) : []
    })
  }
  return assetsOfNode(node, 0, targetWidth)
}

function usertagCountOf(node: Rec): number | undefined {
  const inner = asRec(node['usertags'])?.['in']
  return Array.isArray(inner) ? inner.length : undefined
}

function audioOf(node: Rec): { audioId?: string; audioTitle?: string } {
  const clips = asRec(node['clips_metadata'])
  if (!clips) return {}

  const music = asRec(asRec(clips['music_info'])?.['music_asset_info'])
  if (music) {
    const title = asString(music['title'])
    const artist = asString(music['display_artist'])
    return {
      audioId: asString(music['audio_cluster_id']),
      audioTitle: title && artist ? `${title} — ${artist}` : title,
    }
  }

  const original = asRec(clips['original_sound_info'])
  if (original) {
    return {
      audioId: asString(original['audio_asset_id']),
      audioTitle: asString(original['original_audio_title']),
    }
  }
  return {}
}

/** Um objeto so conta como media se tem shortcode e algum sinal de midia. */
function looksLikeMedia(node: Rec): boolean {
  const code = node['code'] ?? node['shortcode']
  if (typeof code !== 'string' || !SHORTCODE_RE.test(code)) return false
  return (
    'media_type' in node ||
    'product_type' in node ||
    'like_count' in node ||
    'taken_at' in node ||
    '__typename' in node
  )
}

export function parseMedia(value: unknown, targetWidth = 720): ParsedMedia | null {
  const node = asRec(value)
  if (!node || !looksLikeMedia(node)) return null

  const shortcode = asString(node['code']) ?? asString(node['shortcode'])
  if (!shortcode) return null

  const caption = captionOf(node)
  const takenAtRaw = asNumber(node['taken_at']) ?? asNumber(node['taken_at_timestamp'])
  const audio = audioOf(node)

  return {
    shortcode,
    igMediaId: asString(node['pk']) ?? asString(node['id']),
    mediaType: mediaTypeOf(node),
    caption,
    takenAt: takenAtRaw ? new Date(takenAtRaw * 1000) : undefined,
    likeCount: asNumber(node['like_count']),
    commentCount: asNumber(node['comment_count']),
    playCount:
      asNumber(node['play_count']) ?? asNumber(node['ig_play_count']) ?? asNumber(node['view_count']),
    likeCountHidden: asBoolean(node['like_and_view_counts_disabled']),
    audioId: audio.audioId,
    audioTitle: audio.audioTitle,
    locationName: asString(asRec(node['location'])?.['name']),
    hashtags: hashtagsOf(caption),
    author: authorOf(node),
    altText: asString(node['accessibility_caption']),
    assets: assetsOf(node, targetWidth),
    originalWidth: asNumber(node['original_width']),
    originalHeight: asNumber(node['original_height']),
    carouselCount: asNumber(node['carousel_media_count']),
    hasAudio: asBoolean(node['has_audio']),
    videoDurationS: asNumber(node['video_duration']),
    isPaidPartnership: asBoolean(node['is_paid_partnership']),
    repostCount: asNumber(node['media_repost_count']),
    usertagCount: usertagCountOf(node),
    subtitlesLocale: asString(node['video_subtitles_locale']),
  }
}

/**
 * Varre o payload inteiro procurando medias, sem depender de caminho fixo.
 * Cobre o grid do explorar, o timeline graphql e o que vier depois.
 */
export function parseAllMedias(body: unknown, targetWidth = 720): ParsedMedia[] {
  const out = new Map<string, ParsedMedia>()
  const stack: unknown[] = [body]
  let visited = 0

  while (stack.length > 0 && visited < MAX_NODES) {
    const current = stack.pop()
    visited++
    if (current === null || typeof current !== 'object') continue

    let matched = false
    if (!Array.isArray(current)) {
      const parsed = parseMedia(current, targetWidth)
      if (parsed) {
        matched = true
        if (!out.has(parsed.shortcode)) out.set(parsed.shortcode, parsed)
      }
    }

    /**
     * Cada slide de carrossel tem `code` e `pk` proprios, mas nao e um post:
     * nao tem legenda, autor nem curtidas. Descer em `carousel_media` de uma
     * midia ja reconhecida transforma cada slide num post fantasma.
     */
    const children: unknown[] = Array.isArray(current)
      ? current
      : Object.entries(current as Rec)
          .filter(([key]) => !(matched && key === 'carousel_media'))
          .map(([, value]) => value)
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i]
      if (child !== null && typeof child === 'object') stack.push(child)
    }
  }

  return [...out.values()]
}

/** web_profile_info: a unica fonte confiavel de follower_count. */
export function parseProfile(body: unknown): ParsedAuthor | null {
  const user = asRec(asRec(asRec(body)?.['data'])?.['user'])
  if (!user) return null

  const igUserId = asString(user['id']) ?? asString(user['pk'])
  const username = asString(user['username'])
  if (!igUserId || !username) return null

  return {
    igUserId,
    username,
    fullName: asString(user['full_name']),
    isVerified: asBoolean(user['is_verified']),
    followersCount: asNumber(asRec(user['edge_followed_by'])?.['count']) ?? asNumber(user['follower_count']),
  }
}
