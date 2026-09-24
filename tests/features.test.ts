import { describe, expect, it } from 'vitest'
import { extractFeatures } from '../src/parser/features'

const base = { originalWidth: 1080, originalHeight: 1350 }

describe('hook', () => {
  const hook = (caption: string) => extractFeatures({ ...base, caption }).hookType

  it('classifica os tipos', () => {
    expect(hook('Voce sabe por que falhou?')).toBe('pergunta')
    expect(hook('3 erros que te travam')).toBe('numero')
    expect(hook('"A constancia vence o talento"')).toBe('citacao')
    expect(hook('PARE DE FAZER ISSO AGORA')).toBe('grito')
    expect(hook('Pense nisso por um minuto')).toBe('imperativo')
    expect(hook('A constancia e o que separa os dois')).toBe('declaracao')
    expect(hook('')).toBe('sem_legenda')
  })

  it('separa os padroes que dominam o nicho de motivacao', () => {
    expect(hook('Parece simples, mas quase ninguem faz')).toBe('contraste')
    expect(hook('Excelencia nao nasce do extraordinario.')).toBe('negacao')
    expect(hook('Se voce quer crescer, comece hoje')).toBe('condicional')
    expect(hook('Eu passei tres anos tentando isso')).toBe('pessoal')
  })

  it('contraste ganha de negacao quando os dois aparecem', () => {
    expect(hook('Nao e sobre talento, mas sobre constancia')).toBe('contraste')
  })

  it('usa a primeira linha nao vazia', () => {
    expect(hook('\n\n  Quanto voce ganhou hoje?\nresto da legenda')).toBe('pergunta')
  })
})

describe('cta', () => {
  const cta = (caption: string) => extractFeatures({ ...base, caption }).ctaType

  it('detecta os tipos comuns', () => {
    expect(cta('gostou? salva esse post')).toBe('salvar')
    expect(cta('marca um amigo que precisa ver')).toBe('marcar')
    expect(cta('link na bio')).toBe('link')
    expect(cta('me conta nos comentarios')).toBe('comentar')
    expect(cta('texto sem chamada nenhuma')).toBe('nenhum')
  })

  it('link ganha de salvar quando os dois aparecem', () => {
    expect(cta('salva esse post e acessa o link na bio')).toBe('link')
  })
})

describe('contagens e formato', () => {
  it('conta hashtags, mencoes e emojis', () => {
    const f = extractFeatures({ ...base, caption: 'bom dia 🌾☀️ #foco #FÉ @joao @maria.s' })
    expect(f).toMatchObject({ hashtagCount: 2, mentionCount: 2, emojiCount: 2 })
  })

  it('classifica a proporcao', () => {
    expect(extractFeatures({ caption: '', originalWidth: 1080, originalHeight: 1350 }).aspect).toBe('vertical')
    expect(extractFeatures({ caption: '', originalWidth: 1080, originalHeight: 1080 }).aspect).toBe('quadrado')
    expect(extractFeatures({ caption: '', originalWidth: 1920, originalHeight: 1080 }).aspect).toBe('horizontal')
    expect(extractFeatures({ caption: '' }).aspect).toBe('desconhecido')
  })

  it('mede o quanto a legenda grita', () => {
    expect(extractFeatures({ ...base, caption: 'TUDO EM CAIXA ALTA' }).upperRatio).toBe(1)
    expect(extractFeatures({ ...base, caption: 'tudo minusculo' }).upperRatio).toBe(0)
  })

  it('devolve dia e hora no fuso configurado', () => {
    // 2026-09-21T15:00:00Z = 12h de segunda em Sao Paulo
    const f = extractFeatures({ ...base, caption: 'x', takenAt: new Date('2026-09-21T15:00:00Z') })
    expect(f.hour).toBe(12)
    expect(f.weekday).toBe('seg')
  })
})
