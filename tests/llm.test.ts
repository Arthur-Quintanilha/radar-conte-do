import { describe, expect, it } from 'vitest'
import { extrairLista } from '../src/servidor/ia/json'

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

describe('resposta da IA quebrada', () => {
  it('aproveita os objetos legiveis quando a lista nao fecha', async () => {
    const { extrairLista } = await import('../src/servidor/ia/json')
    const texto = '```json\n[\n { "id": "A", "encaixe": "fora", "motivo": "ok, com } dentro" },\n { "id": "B", "motivo": "cita "gambiarra" sem escape" },\n { "id": "C", "encaixe": "dentro" },\n { "id": "D", "enc'
    const ids = extrairLista(texto).map((o) => (o as { id: string }).id)
    expect(ids).toContain('A')
    expect(ids).toContain('C')
    expect(ids).not.toContain('D')
  })
  it('lista inteira continua igual', async () => {
    const { extrairLista } = await import('../src/servidor/ia/json')
    expect(extrairLista('```json\n[{"id":"A"},{"id":"B"}]\n```')).toHaveLength(2)
  })
})
