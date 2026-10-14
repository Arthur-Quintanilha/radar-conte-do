import { describe, expect, it } from 'vitest'
import { extractItems } from '../src/comum/parser/extract'

describe('extractItems', () => {
  it('acha midias em qualquer profundidade do payload', () => {
    const payload = {
      sectional_items: [
        {
          layout_content: {
            medias: [
              { media: { pk: '123', code: 'CxAbC1defGh', media_type: 2, product_type: 'clips' } },
              { media: { pk: '456', code: 'DyZzz9aaBBc', media_type: 8 } },
            ],
          },
        },
      ],
    }

    const items = extractItems(payload)

    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ shortcode: 'CxAbC1defGh', mediaId: '123', mediaType: 'reel' })
    expect(items[1]).toMatchObject({ shortcode: 'DyZzz9aaBBc', mediaId: '456', mediaType: 'carousel' })
  })

  it('preserva a ordem do grid', () => {
    const payload = {
      items: [
        { code: 'AAAAAAAAAAA', pk: 1 },
        { code: 'BBBBBBBBBBB', pk: 2 },
        { code: 'CCCCCCCCCCC', pk: 3 },
      ],
    }
    expect(extractItems(payload).map((i) => i.shortcode)).toEqual([
      'AAAAAAAAAAA',
      'BBBBBBBBBBB',
      'CCCCCCCCCCC',
    ])
  })

  it('aceita shortcode no formato graphql', () => {
    const payload = { data: { xdt_shortcode_media: { shortcode: 'CxAbC1defGh', id: '999', __typename: 'XDTGraphVideo' } } }
    expect(extractItems(payload)[0]).toMatchObject({ shortcode: 'CxAbC1defGh', mediaId: '999', mediaType: 'video' })
  })

  it('ignora strings que nao parecem shortcode', () => {
    expect(extractItems({ code: 'abc' })).toHaveLength(0)
    expect(extractItems({ code: 'pt-BR' })).toHaveLength(0)
  })

  it('nao duplica o mesmo shortcode', () => {
    const payload = [{ code: 'CxAbC1defGh', pk: '1' }, { items: [{ code: 'CxAbC1defGh', pk: '1' }] }]
    expect(extractItems(payload)).toHaveLength(1)
  })
})
