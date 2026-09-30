import { describe, expect, it } from 'vitest'
import { isExploreCapture, isSearchCapture } from '../src/parser/run'

describe('isExploreCapture', () => {
  it('aceita o grid do explorar', () => {
    expect(isExploreCapture({ endpointKind: 'explore_grid', pageUrl: null })).toBe(true)
  })

  it('recusa graphql com o explorar aberto: e o feed da home carregando por baixo', () => {
    expect(
      isExploreCapture({ endpointKind: 'graphql', pageUrl: 'https://www.instagram.com/explore/' }),
    ).toBe(false)
  })

  it('recusa o mesmo endpoint capturado numa pagina de perfil', () => {
    expect(
      isExploreCapture({ endpointKind: 'graphql', pageUrl: 'https://www.instagram.com/visaodoka/' }),
    ).toBe(false)
  })

  it('recusa o feed da home', () => {
    expect(isExploreCapture({ endpointKind: 'graphql', pageUrl: 'https://www.instagram.com/' })).toBe(false)
  })

  it('recusa resultados de busca, hashtag e local, mesmo morando em /explore/', () => {
    for (const pagina of [
      'https://www.instagram.com/explore/search/keyword/?q=mvp',
      'https://www.instagram.com/explore/tags/startup/',
      'https://www.instagram.com/explore/locations/123/belo-horizonte/',
    ]) {
      expect(isExploreCapture({ endpointKind: 'graphql', pageUrl: pagina })).toBe(false)
      expect(isExploreCapture({ endpointKind: 'explore_grid', pageUrl: pagina })).toBe(false)
    }
  })

  it('aceita o grid com o explorar com ou sem barra e com parametros', () => {
    expect(isExploreCapture({ endpointKind: 'explore_grid', pageUrl: 'https://www.instagram.com/explore' })).toBe(true)
    expect(isExploreCapture({ endpointKind: 'explore_grid', pageUrl: 'https://www.instagram.com/explore/?next=%2F' })).toBe(true)
  })

  it('recusa o que a caixa de busca pede, mesmo com o explorar aberto por baixo', () => {
    for (const endpointKind of ['search', 'other']) {
      expect(isExploreCapture({ endpointKind, pageUrl: 'https://www.instagram.com/explore/' })).toBe(false)
    }
  })

  it('recusa capturas antigas sem pageUrl', () => {
    expect(isExploreCapture({ endpointKind: 'graphql', pageUrl: null })).toBe(false)
  })

  it('separa a busca do explorar', () => {
    const busca = 'https://www.instagram.com/explore/search/keyword/?q=software%20house'
    expect(isSearchCapture({ endpointKind: 'graphql', pageUrl: busca })).toBe(true)
    expect(isSearchCapture({ endpointKind: 'graphql', pageUrl: 'https://www.instagram.com/explore/' })).toBe(false)
    expect(isSearchCapture({ endpointKind: 'graphql', pageUrl: 'https://www.instagram.com/explore/tags/mvp/' })).toBe(false)
  })
})

import { isWatchCapture, ownPosts, profileUsernameOf } from '../src/parser/run'

describe('visitas a perfis acompanhados', () => {
  const runs = new Set(['run-watch'])

  it('le o dono do perfil pela URL e ignora rotas do Instagram', () => {
    expect(profileUsernameOf('https://www.instagram.com/Commandixtech/')).toBe('commandixtech')
    expect(profileUsernameOf('https://www.instagram.com/commandixtech/reels/')).toBe('commandixtech')
    expect(profileUsernameOf('https://www.instagram.com/explore/')).toBeNull()
    expect(profileUsernameOf('https://www.instagram.com/p/ABC123/')).toBeNull()
  })

  it('so aproveita capturas de sessoes de acompanhamento', () => {
    const perfil = 'https://www.instagram.com/commandixtech/'
    expect(isWatchCapture({ endpointKind: 'html', pageUrl: perfil, runId: 'run-watch' }, runs)).toBe('commandixtech')
    // o sync de seguidores tambem abre perfis, mas nao vira post
    expect(isWatchCapture({ endpointKind: 'graphql', pageUrl: perfil, runId: 'run-authors' }, runs)).toBeNull()
  })

  it('fica so com os posts do dono', () => {
    const m = (shortcode: string, username?: string) =>
      ({ shortcode, author: username ? { igUserId: '1', username } : undefined }) as never
    const lista = [m('A1', 'commandixtech'), m('B2', 'outra'), m('C3')]
    expect(ownPosts(lista, 'commandixtech').map((x: { shortcode: string }) => x.shortcode)).toEqual(['A1'])
    expect(ownPosts(lista, 'commandixtech', true).map((x: { shortcode: string }) => x.shortcode)).toEqual(['A1', 'C3'])
  })
})
