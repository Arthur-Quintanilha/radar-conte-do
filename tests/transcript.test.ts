import { describe, expect, it } from 'vitest'
import { srtToText } from '../src/enricher/transcript'

describe('srtToText', () => {
  it('tira indices e marcacoes de tempo', () => {
    const srt = `1
00:00:00,000 --> 00:00:02,000
Bom dia pessoal

2
00:00:02,000 --> 00:00:04,500
hoje eu quero falar de constancia`
    expect(srtToText(srt)).toBe('Bom dia pessoal hoje eu quero falar de constancia')
  })

  it('colapsa a repeticao progressiva da legenda automatica', () => {
    // o Instagram reescreve a frase inteira a cada bloco enquanto a pessoa fala
    const srt = `1
00:00:00,000 --> 00:00:01,000
Eu passei

2
00:00:01,000 --> 00:00:02,000
Eu passei tres anos

3
00:00:02,000 --> 00:00:03,000
Eu passei tres anos tentando`
    expect(srtToText(srt)).toBe('Eu passei tres anos tentando')
  })

  it('remove blocos identicos e tags', () => {
    const srt = `1
00:00:00,000 --> 00:00:01,000
<i>mesma frase</i>

2
00:00:01,000 --> 00:00:02,000
mesma frase

3
00:00:02,000 --> 00:00:03,000
frase nova`
    expect(srtToText(srt)).toBe('mesma frase frase nova')
  })

  it('aceita ponto no lugar da virgula nos milissegundos', () => {
    expect(srtToText('1\n00:00:00.000 --> 00:00:01.000\nfunciona')).toBe('funciona')
  })

  it('devolve vazio para arquivo sem falas', () => {
    expect(srtToText('')).toBe('')
    expect(srtToText('1\n00:00:00,000 --> 00:00:01,000\n')).toBe('')
  })
})
