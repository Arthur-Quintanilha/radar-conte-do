import { describe, expect, it } from 'vitest'
import { suggestAuthorClass, suggestRelevance } from '../src/parser/classify'

describe('suggestAuthorClass', () => {
  it('reconhece software house pela bio', () => {
    const r = suggestAuthorClass({
      username: 'commandixtech',
      fullName: 'Commandix | AI Solutions',
      biography: 'Software house • Desenvolvemos sistemas e aplicativos sob medida para empresas',
    })
    expect(r.valor).toBe('concorrente')
    expect(r.motivos).toContain('software house')
  })

  it('reconhece criador de conteudo para dev', () => {
    const r = suggestAuthorClass({
      username: 'erickscur',
      fullName: 'Erick Scur | 1% Programador',
      captions: ['COMO FICAR VICIADO EM ESTUDAR PROGRAMAÇÃO', 'Lógica de programação para iniciantes'],
    })
    expect(r.valor).toBe('publico')
  })

  it('reconhece lideranca', () => {
    const r = suggestAuthorClass({ username: 'fulano', fullName: 'Fulano', biography: 'CTO @empresa · ex-Head of Engineering' })
    expect(r.valor).toBe('referencia')
  })

  it('nao casa pedaco de palavra', () => {
    const r = suggestAuthorClass({ username: 'x', biography: 'projecto de arquitectura' })
    expect(r.motivos).not.toContain('cto')
  })
})

describe('suggestRelevance', () => {
  it('post que fala com empresario e alta', () => {
    const r = suggestRelevance(
      'Empresário, você que está buscando desenvolver um sistema sob medida para sua empresa? Nossa software house resolve.',
    )
    expect(r.valor).toBe('alta')
  })
  it('meme de programador e baixa', () => {
    expect(suggestRelevance('Quem é programador sabe 😂 #programacao #memes').valor).toBe('baixa')
  })
})
