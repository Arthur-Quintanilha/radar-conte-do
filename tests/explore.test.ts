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
