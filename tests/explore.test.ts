import { describe, expect, it } from 'vitest'
import { isExploreCapture } from '../src/parser/run'

describe('isExploreCapture', () => {
  it('aceita o grid do explorar', () => {
    expect(isExploreCapture({ endpointKind: 'explore_grid', pageUrl: null })).toBe(true)
  })

  it('aceita graphql capturado com o explorar aberto', () => {
    expect(
      isExploreCapture({ endpointKind: 'graphql', pageUrl: 'https://www.instagram.com/explore/' }),
    ).toBe(true)
  })

  it('recusa o mesmo endpoint capturado numa pagina de perfil', () => {
    expect(
      isExploreCapture({ endpointKind: 'graphql', pageUrl: 'https://www.instagram.com/visaodoka/' }),
    ).toBe(false)
  })

  it('recusa o feed da home', () => {
    expect(isExploreCapture({ endpointKind: 'graphql', pageUrl: 'https://www.instagram.com/' })).toBe(false)
  })

  it('recusa capturas antigas sem pageUrl', () => {
    expect(isExploreCapture({ endpointKind: 'graphql', pageUrl: null })).toBe(false)
  })
})
