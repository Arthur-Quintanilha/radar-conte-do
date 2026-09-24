import { describe, expect, it } from 'vitest'
import { parseSearchPage, searchTermOf } from '../src/parser/search'
import { parseTermsFile, pickNext } from '../src/collector/terms'

const media = (code: string, likes: number, username: string) => ({
  __typename: 'XDTMediaDict',
  pk: `${code}-pk`,
  id: `${code}-pk_1`,
  code,
  media_type: 2,
  taken_at: 1772796280,
  like_count: likes,
  comment_count: 3,
  caption: { text: `legenda de ${code} #mvp` },
  user: { pk: `${username}-id`, username, full_name: username.toUpperCase(), is_verified: false },
  image_versions2: { candidates: [{ url: `https://cdn/${code}.jpg`, width: 720, height: 1280 }] },
})

const body = {
  data: {
    xdt_viewer: {},
    xdt_fbsearch__top_serp_graphql: {
      edges: [
        { node: { __typename: 'XDTTopSerpHeaderUnit' }, cursor: null },
        { node: { __typename: 'XDTTopSerpAccountsHCMUnit' }, cursor: null },
        { node: { __typename: 'XDTTopSerpMediaGridUnit', items: [media('AAAAAAAAAA1', 10, 'kxp'), media('AAAAAAAAAA2', 20, 'outra')] } },
        { node: { __typename: 'XDTTopSerpMediaGridUnit', items: [media('AAAAAAAAAA3', 30, 'kxp'), media('AAAAAAAAAA1', 10, 'kxp')] } },
      ],
      page_info: { has_next_page: true, end_cursor: 'abc' },
    },
  },
}

describe('parseSearchPage', () => {
  it('le a grade na ordem da tela, sem cabecalho e sem repetir', () => {
    const page = parseSearchPage(body)
    expect(page?.medias.map((m) => m.shortcode)).toEqual(['AAAAAAAAAA1', 'AAAAAAAAAA2', 'AAAAAAAAAA3'])
    expect(page?.hasNextPage).toBe(true)
    expect(page?.medias[1]?.author?.username).toBe('outra')
    expect(page?.medias[2]?.likeCount).toBe(30)
  })

  it('ignora respostas que nao sao a SERP', () => {
    expect(parseSearchPage({ data: { xdt_api__v1__feed__reels_tray: {} } })).toBeNull()
    expect(parseSearchPage(null)).toBeNull()
  })
})

describe('termos', () => {
  it('le o arquivo ignorando comentario, vazio e repetido', () => {
    const txt = '# cabecalho\n\nSoftware  House\nMVP # comentario\nsoftware house\r\n'
    expect(parseTermsFile(txt)).toEqual(['software house', 'mvp'])
  })

  it('pega o termo da URL da busca', () => {
    expect(searchTermOf('https://www.instagram.com/explore/search/keyword/?q=Desenvolvimento%20de%20Software')).toBe(
      'desenvolvimento de software',
    )
  })

  it('prioriza o nunca pesquisado, depois o mais antigo', () => {
    const d = (s: string) => new Date(s)
    expect(
      pickNext([
        { termo: 'a', buscas: 2, ultima: d('2026-09-20') },
        { termo: 'b', buscas: 0, ultima: null },
      ]),
    ).toBe('b')
    expect(
      pickNext([
        { termo: 'a', buscas: 2, ultima: d('2026-09-20') },
        { termo: 'b', buscas: 1, ultima: d('2026-09-10') },
      ]),
    ).toBe('b')
  })
})
