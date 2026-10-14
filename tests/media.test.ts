import { describe, expect, it } from 'vitest'
import { parseAllMedias, parseMedia, parseProfile } from '../src/comum/parser/media'

// formas copiadas dos payloads reais capturados na primeira coleta
const gridMedia = {
  pk: '3812345',
  id: '3812345_99',
  code: 'DdH5EdPDlfz',
  media_type: 1,
  product_type: 'feed',
  like_count: 2749,
  comment_count: 5,
  like_and_view_counts_disabled: false,
  taken_at: 1789993985,
  caption: { pk: '1', text: 'bom dia #motivacao #FÉ e foco', has_translation: false },
  user: { pk: '77', id: '77', username: 'sobremotiivacao', full_name: 'Sobre', is_verified: false },
}

const reelMedia = {
  pk: '99',
  code: 'DdWRBHTOVbh',
  media_type: 2,
  product_type: 'clips',
  like_count: 1,
  comment_count: 0,
  view_count: 4210,
  taken_at: 1789561062,
  caption: { text: 'olha isso #reels' },
  user: { pk: '5', username: 'toppayy' },
  clips_metadata: {
    music_info: { music_asset_info: { audio_cluster_id: 'a1', title: 'Faixa', display_artist: 'Artista' } },
  },
  location: { name: 'Ouro Preto' },
}

describe('parseMedia', () => {
  it('le o grid do explorar', () => {
    const m = parseMedia(gridMedia)
    expect(m).toMatchObject({
      shortcode: 'DdH5EdPDlfz',
      igMediaId: '3812345',
      mediaType: 'image',
      likeCount: 2749,
      commentCount: 5,
      likeCountHidden: false,
    })
    expect(m?.takenAt?.toISOString()).toBe(new Date(1789993985 * 1000).toISOString())
    expect(m?.author).toMatchObject({ igUserId: '77', username: 'sobremotiivacao', isVerified: false })
    expect(m?.author?.followersCount).toBeUndefined()
  })

  it('classifica reel e le audio, views e local', () => {
    const m = parseMedia(reelMedia)
    expect(m).toMatchObject({
      mediaType: 'reel',
      playCount: 4210,
      audioId: 'a1',
      audioTitle: 'Faixa — Artista',
      locationName: 'Ouro Preto',
    })
  })

  it('extrai hashtags com acento e sem duplicar', () => {
    expect(parseMedia(gridMedia)?.hashtags).toEqual(['motivacao', 'fé'])
    expect(parseMedia({ ...gridMedia, caption: { text: '#a #A #a' } })?.hashtags).toEqual(['a'])
  })

  it('carousel_container vira carousel', () => {
    expect(parseMedia({ ...gridMedia, media_type: 8, product_type: 'carousel_container' })?.mediaType).toBe('carousel')
  })

  it('ignora objeto sem cara de midia', () => {
    expect(parseMedia({ code: 'DdH5EdPDlfz' })).toBeNull()
    expect(parseMedia({ media_type: 1 })).toBeNull()
    expect(parseMedia('nada')).toBeNull()
  })
})

describe('parseAllMedias', () => {
  it('acha medias no grid e no timeline, na ordem', () => {
    const grid = { sectional_items: [{ layout_content: { medias: [{ media: gridMedia }, { media: reelMedia }] } }] }
    expect(parseAllMedias(grid).map((m) => m.shortcode)).toEqual(['DdH5EdPDlfz', 'DdWRBHTOVbh'])

    const timeline = {
      data: {
        xdt_api__v1__feed__timeline__connection: {
          edges: [{ node: { media: null, __typename: 'X' } }, { node: { media: reelMedia } }],
        },
      },
    }
    expect(parseAllMedias(timeline).map((m) => m.shortcode)).toEqual(['DdWRBHTOVbh'])
  })
})

describe('parseProfile', () => {
  it('le o follower_count do web_profile_info', () => {
    const body = {
      data: {
        user: {
          id: '77',
          username: 'sobremotiivacao',
          full_name: 'Sobre',
          is_verified: true,
          edge_followed_by: { count: 128000 },
        },
      },
    }
    expect(parseProfile(body)).toEqual({
      igUserId: '77',
      username: 'sobremotiivacao',
      fullName: 'Sobre',
      isVerified: true,
      followersCount: 128000,
    })
  })

  it('devolve null para payload de outra coisa', () => {
    expect(parseProfile({ data: {} })).toBeNull()
  })
})

describe('assets', () => {
  const comImagem = {
    ...gridMedia,
    image_versions2: {
      candidates: [
        { url: 'https://cdn/1080.jpg', width: 1080, height: 1440 },
        { url: 'https://cdn/720.jpg', width: 720, height: 960 },
        { url: 'https://cdn/320.jpg', width: 320, height: 427 },
      ],
    },
  }

  it('escolhe o menor candidato acima da largura alvo', () => {
    expect(parseMedia(comImagem, 720)?.assets).toEqual([
      { position: 0, kind: 'image', url: 'https://cdn/720.jpg', width: 720, height: 960 },
    ])
    expect(parseMedia(comImagem, 400)?.assets[0]?.url).toBe('https://cdn/720.jpg')
    expect(parseMedia(comImagem, 300)?.assets[0]?.url).toBe('https://cdn/320.jpg')
  })

  it('cai para o maior quando nenhum alcanca o alvo', () => {
    expect(parseMedia(comImagem, 4000)?.assets[0]?.url).toBe('https://cdn/1080.jpg')
  })

  it('carrossel rende um asset por filho, em ordem', () => {
    const carrossel = {
      ...gridMedia,
      media_type: 8,
      carousel_media: [
        { pk: 'a', image_versions2: { candidates: [{ url: 'https://cdn/a.jpg', width: 720, height: 960 }] } },
        { pk: 'b', image_versions2: { candidates: [{ url: 'https://cdn/b.jpg', width: 720, height: 960 }] } },
      ],
    }
    expect(parseMedia(carrossel, 720)?.assets.map((a) => [a.position, a.url])).toEqual([
      [0, 'https://cdn/a.jpg'],
      [1, 'https://cdn/b.jpg'],
    ])
  })

  it('video rende capa e video', () => {
    const video = {
      ...reelMedia,
      image_versions2: { candidates: [{ url: 'https://cdn/capa.jpg', width: 720, height: 1280 }] },
      video_versions: [{ url: 'https://cdn/v.mp4', width: 720, height: 1280 }],
      video_duration: 21.5,
    }
    const assets = parseMedia(video, 720)?.assets ?? []
    expect(assets.map((a) => a.kind)).toEqual(['image', 'video'])
    expect(assets[1]).toMatchObject({ url: 'https://cdn/v.mp4', durationS: 21.5 })
  })

  it('le o alt text do instagram', () => {
    expect(parseMedia({ ...gridMedia, accessibility_caption: 'Foto de um cachorro' })?.altText).toBe(
      'Foto de um cachorro',
    )
  })
})

describe('slides de carrossel', () => {
  const carrossel = {
    pk: '100',
    code: 'PAIPAIPAIPA',
    media_type: 8,
    carousel_media_count: 3,
    like_count: 500,
    taken_at: 1789993985,
    caption: { text: 'o post de verdade' },
    user: { pk: '7', username: 'conta' },
    carousel_media: [
      { pk: '101', code: 'FILHO1AAAAA', media_type: 1, taken_at: 1789993985 },
      { pk: '102', code: 'FILHO2AAAAA', media_type: 1, taken_at: 1789993985 },
      { pk: '103', code: 'FILHO3AAAAA', media_type: 1, taken_at: 1789993985 },
    ],
  }

  it('nao viram posts independentes', () => {
    const encontrados = parseAllMedias(carrossel).map((m) => m.shortcode)
    expect(encontrados).toEqual(['PAIPAIPAIPA'])
  })

  it('mas continuam virando assets do post pai', () => {
    const pai = parseAllMedias({
      ...carrossel,
      carousel_media: carrossel.carousel_media.map((c) => ({
        ...c,
        image_versions2: { candidates: [{ url: `https://cdn/${c.pk}.jpg`, width: 720, height: 960 }] },
      })),
    })[0]
    expect(pai?.assets.map((a) => a.position)).toEqual([0, 1, 2])
  })
})
