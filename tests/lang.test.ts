import { describe, expect, it } from 'vitest'
import { detectLang } from '../src/parser/lang'

describe('detectLang', () => {
  it('reconhece portugues', () => {
    expect(detectLang('Empresário, você que está buscando desenvolver um sistema sob medida para sua empresa')).toBe('pt')
    expect(detectLang('Transformação digital não é só tecnologia #ti #dev')).toBe('pt')
  })
  it('reconhece ingles', () => {
    expect(detectLang('Building my dream software company with the best team in the world')).toBe('en')
  })
  it('reconhece indonesio e espanhol', () => {
    expect(detectLang('Di balik setiap website dan aplikasi, ada tim yang bekerja untuk kamu')).toBe('id')
    expect(detectLang('El desarrollo de software con los mejores equipos y también la mejor calidad')).toBe('es')
  })
  it('nao chuta com pouco texto', () => {
    expect(detectLang('#programmer #ai')).toBe('indefinido')
    expect(detectLang(null)).toBe('indefinido')
  })
})
