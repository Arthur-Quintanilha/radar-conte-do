import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import express from 'express'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/** O worker falando com a API por HTTP, como o app instalado vai fazer. */
const MIDIA = mkdtempSync(join(tmpdir(), 'midia-'))
process.env['DATABASE_URL'] = 'pglite:memory'
process.env['PAINEL_SEM_LOGIN'] = '1'
process.env['MEDIA_DIR'] = MIDIA

let api: Server
let url = ''

beforeAll(async () => {
  const { run } = await import('../src/servidor/db/client')
  const { sql } = await import('drizzle-orm')
  for (const f of ['0000_inicial.sql', '0001_usuarios.sql', '0002_persona_por_usuario.sql'])
    for (const st of readFileSync(`drizzle/${f}`, 'utf8').split('--> statement-breakpoint')) if (st.trim()) await run(sql.raw(st))
  // um post com legenda .srt baixada neste "computador"
  await run(sql`insert into post (id, shortcode, last_seen_at, first_seen_at) values ('p1', 'ABC123', ${Math.floor(Date.now() / 1000)}, ${Math.floor(Date.now() / 1000)})`)
  await run(sql`insert into media_asset (id, post_id, position, kind, remote_url) values ('m1', 'p1', 0, 'subtitle', 'https://x/1.srt')`)
  mkdirSync(join(MIDIA, 'ABC123'), { recursive: true })
  writeFileSync(join(MIDIA, 'ABC123', '0-subtitle.srt'), '1\n00:00:00,000 --> 00:00:02,000\nOla pessoal\n')

  const { montarSoApi } = await import('../src/cli/montar')
  montarSoApi()
  const { criarApp } = await import('../src/servidor/api/app')
  api = criarApp().listen(0)
  await new Promise((ok) => api.once('listening', ok))
  url = `http://127.0.0.1:${(api.address() as AddressInfo).port}`
  const { definirServidor } = await import('../src/worker/servidor')
  const { servidorHttp } = await import('../src/worker/servidorHttp')
  definirServidor(servidorHttp({ url, token: () => null }))
}, 60_000)

afterAll(async () => {
  api?.close()
  const { closeDb } = await import('../src/servidor/db/client')
  await closeDb()
})

describe('worker pela rede', () => {
  it('lê a legenda da pasta local e grava a transcrição no servidor', async () => {
    const { ingestSubtitles } = await import('../src/worker/midia/transcript')
    expect(await ingestSubtitles()).toMatchObject({ candidates: 1, saved: 1 })
    const { all } = await import('../src/servidor/db/client')
    const { sql } = await import('drizzle-orm')
    const [r] = await all<{ t: string }>(sql`select output->>'text' as t from enrichment where post_id = 'p1' and kind = 'transcript'`)
    expect(r?.t).toBe('Ola pessoal')
  })

  it('junta as capturas em lote e apaga o corpo bruto depois do parse', async () => {
    const { servidor } = await import('../src/worker/servidor')
    const srv = servidor()
    const run = await srv.abrirColeta('watch')
    for (let i = 0; i < 30; i++) await srv.salvarCaptura(run, { url: 'https://www.instagram.com/x', pageUrl: 'https://www.instagram.com/x/', kind: 'html', status: 200, body: { i }, bodyHash: String(i), capturedAt: Date.now() })
    await srv.fecharColeta(run, { status: 'ok', responsesCaptured: 30 })
    expect((await srv.processarCapturas()).rawProcessed).toBe(30)
    const { all } = await import('../src/servidor/db/client')
    const { sql } = await import('drizzle-orm')
    const [r] = await all<{ n: number }>(sql`select count(*)::int as n from raw_response where body->>'omitido' = 'true'`)
    expect(r?.n).toBe(30)
  })
})

describe('etapa de IA que pede imagens', () => {
  it('extrai da pasta local e chama de novo até terminar', async () => {
    // servidor falso: na primeira chamada pede quadros; na segunda confere que vieram
    const recebidos: unknown[] = []
    const fake = express()
    fake.use(express.json({ limit: '10mb' }))
    fake.post('/api/worker/etapa', (req, res) => {
      recebidos.push(req.body.imagens ?? null)
      if (!req.body.imagens) res.json({ resultado: { linha: 'lote 1', gravados: 3, lotes: 1, faltam: [{ tipo: 'quadros', shortcode: 'ABC123', maxQuadros: 2, maxSlides: 2, largura: 320 }] } })
      else res.json({ resultado: { linha: 'pronto', gravados: 2, lotes: 1 } })
    })
    const s = fake.listen(0)
    await new Promise((ok) => s.once('listening', ok))
    const { servidorHttp } = await import('../src/worker/servidorHttp')
    const srv = servidorHttp({ url: `http://127.0.0.1:${(s.address() as AddressInfo).port}`, token: () => null })
    const r = await srv.etapa('encaixe', { personaId: 'p' })
    s.close()
    expect(r).toEqual({ linha: 'pronto', gravados: 5, lotes: 2 })
    expect(recebidos[0]).toBeNull()
    // sem arquivo de video/imagem o post nao tem quadros, mas o pedido foi atendido
    expect(Object.keys(recebidos[1] as object)).toHaveLength(1)
  })
})
