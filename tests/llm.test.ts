import { describe, expect, it } from 'vitest'
import { extrairLista } from '../src/llm/importar'
import { authorAnswer, postAnswer } from '../src/llm/schema'

describe('extrairLista', () => {
  it('acha a lista dentro do bloco json, com texto em volta', () => {
    const texto = 'Claro! Segue:\n```json\n[{"id":"@a","classe":"fora"}]\n```\nQualquer coisa me avise.'
    expect(extrairLista(texto)).toEqual([{ id: '@a', classe: 'fora' }])
  })
  it('aceita lista solta e objeto com a lista dentro', () => {
    expect(extrairLista('[{"id":"x"}]')).toEqual([{ id: 'x' }])
    expect(extrairLista('{"contas":[{"id":"x"}]}')).toEqual([{ id: 'x' }])
  })
  it('explica quando nao ha JSON', () => {
    expect(() => extrairLista('nao sei')).toThrow(/lista JSON/)
  })
})

describe('formato da resposta', () => {
  it('normaliza acento, maiuscula e porcentagem', () => {
    const r = authorAnswer.parse({ id: '@x', classe: 'Referência: Produto', confianca: '85%', motivo: 'bio' })
    expect(r.classe).toBe('referencia_produto')
    expect(r.confianca).toBeCloseTo(0.85)
    expect(r.sinais).toEqual([])
  })
  it('recusa classe inventada', () => {
    expect(authorAnswer.safeParse({ id: '@x', classe: 'parceiro', confianca: 0.5, motivo: 'x' }).success).toBe(false)
  })
  it('post: relevancia com acento e publico opcional', () => {
    const r = postAnswer.parse({ id: 'ABC', relevancia: 'Média', confianca: 0.7, motivo: 'x' })
    expect(r.relevancia).toBe('media')
    expect(r.angulo).toBe('')
  })
})

describe('posts v2: formato', () => {
  it('normaliza o formato e troca desconhecido por outro', () => {
    expect(postAnswer.parse({ id: 'A', relevancia: 'alta', formato: 'Anúncio', confianca: 0.8, motivo: 'x' }).formato).toBe('anuncio')
    expect(postAnswer.parse({ id: 'A', relevancia: 'alta', formato: 'Opinião', confianca: 0.8, motivo: 'x' }).formato).toBe('opiniao')
    expect(postAnswer.parse({ id: 'A', relevancia: 'alta', formato: 'carrossel', confianca: 0.8, motivo: 'x' }).formato).toBe('outro')
  })
  it('resposta v1 sem formato continua valida', () => {
    expect(postAnswer.parse({ id: 'A', relevancia: 'baixa', confianca: 0.8, motivo: 'x' }).formato).toBeUndefined()
  })
})
