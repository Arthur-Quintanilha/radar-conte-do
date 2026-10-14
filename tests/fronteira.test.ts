import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, normalize, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * As tres camadas do codigo e quem pode importar quem:
 *  - comum: tipos, parser e utilitarios. Nao importa nada das outras.
 *  - servidor: banco, IA, API. So importa comum.
 *  - worker: Chrome, midia, Whisper, etapas locais. So importa comum (fala com o
 *    servidor pela porta, nunca pelo banco).
 * src/cli e quem monta tudo junto, e pode importar qualquer uma.
 */
const RAIZ = join(__dirname, '..', 'src')
const PODE: Record<string, string[]> = { comum: ['comum'], servidor: ['servidor', 'comum'], worker: ['worker', 'comum'] }

function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? arquivos(p) : p.endsWith('.ts') ? [p] : []
  })
}
const camada = (p: string): string => relative(RAIZ, p).split(/[\\/]/)[0] ?? ''

describe('fronteira entre comum, servidor e worker', () => {
  for (const c of Object.keys(PODE)) {
    it(`${c} so importa ${PODE[c]!.join(' e ')}`, () => {
      const erradas: string[] = []
      for (const f of arquivos(join(RAIZ, c))) {
        for (const m of readFileSync(f, 'utf8').matchAll(/(?:from|import)\s*\(?\s*['"](\.[^'"]+)['"]/g)) {
          const alvo = normalize(join(dirname(f), m[1]!))
          const de = alvo.startsWith(RAIZ) ? camada(alvo) : 'fora de src'
          if (!PODE[c]!.includes(de)) erradas.push(`${relative(RAIZ, f)} -> ${m[1]}`)
        }
      }
      expect(erradas).toEqual([])
    })
  }
})
