import { describe, expect, it } from 'vitest'
import { extractProfileFromHtml, parseCountText } from '../src/collector/profileExtract'

describe('parseCountText', () => {
  it('le separador de milhar em pt e en', () => {
    expect(parseCountText('1.234 seguidores')).toBe(1234)
    expect(parseCountText('1,234 Followers, 56 Following')).toBe(1234)
    expect(parseCountText('512 seguidores')).toBe(512)
  })

  it('le sufixos abreviados nos dois idiomas', () => {
    expect(parseCountText('128 mil seguidores')).toBe(128_000)
    expect(parseCountText('128K Followers')).toBe(128_000)
    expect(parseCountText('1,2 mi seguidores')).toBe(1_200_000)
    expect(parseCountText('1.2M Followers')).toBe(1_200_000)
  })

  it('devolve undefined quando nao ha numero', () => {
    expect(parseCountText('sem numero aqui')).toBeUndefined()
    expect(parseCountText(null)).toBeUndefined()
    expect(parseCountText('')).toBeUndefined()
  })
})

describe('extractProfileFromHtml', () => {
  const blob = (obj: unknown) => `<script type="application/json">${JSON.stringify(obj)}</script>`

  it('acha o usuario certo dentro do blob json', () => {
    const html = `<html>${blob({
      require: [['x', 'y', {}, [{ data: { user: { id: '77', username: 'alvo', full_name: 'Alvo', is_verified: true, edge_followed_by: { count: 128_000 } } } }]]],
    })}</html>`

    expect(extractProfileFromHtml(html, 'alvo')).toEqual({
      username: 'alvo',
      igUserId: '77',
      fullName: 'Alvo',
      isVerified: true,
      followersCount: 128_000,
      source: 'json',
    })
  })

  it('ignora outro usuario presente na mesma pagina', () => {
    const html = `<html>${blob({ user: { username: 'outro', follower_count: 999 } })}</html>`
    const facts = extractProfileFromHtml(html, 'alvo')
    expect(facts?.source).not.toBe('json')
    expect(facts?.followersCount).toBe(999) // cai no regex, que nao distingue
  })

  it('cai para o regex quando o script nao e json valido', () => {
    const html = `<html><script>window.__d("x",[],function(){ "follower_count":4321 })</script></html>`
    expect(extractProfileFromHtml(html, 'alvo')).toMatchObject({ followersCount: 4321, source: 'regex' })
  })

  it('cai para a meta description como ultimo recurso', () => {
    const html = `<html><head><meta property="og:description" content="128K Followers, 512 Following, 90 Posts"></head></html>`
    expect(extractProfileFromHtml(html, 'alvo')).toMatchObject({ followersCount: 128_000, source: 'meta' })
  })

  it('devolve null quando nao ha nada', () => {
    expect(extractProfileFromHtml('<html><body>nada</body></html>', 'alvo')).toBeNull()
  })
})

import { profileFromGraphql } from '../src/collector/profileExtract'

describe('profileFromGraphql', () => {
  const body = {
    data: {
      user: {
        pk: '531914599',
        username: 'nobrega.dev',
        full_name: 'Felipe Nóbrega | Sistemas e Automação',
        biography: 'Sistemas sob medida e agentes de IA para empresas',
        follower_count: 4078,
        is_verified: false,
        category: 'Tecnologia',
      },
      viewer: {},
    },
  }
  it('le seguidores exatos, bio e categoria', () => {
    const f = profileFromGraphql(body, 'Nobrega.dev')
    expect(f?.followersCount).toBe(4078)
    expect(f?.biography).toContain('sob medida')
    expect(f?.category).toBe('Tecnologia')
    expect(f?.source).toBe('graphql')
  })
  it('ignora quando o usuario e outro', () => {
    expect(profileFromGraphql(body, 'outra')).toBeNull()
    expect(profileFromGraphql({ data: { viewer: {} } })).toBeNull()
  })
})
