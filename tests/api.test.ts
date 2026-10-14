import { readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * A API de ponta a ponta, num Postgres em memória (PGlite) e com um Supabase
 * falso: o token é o próprio id do usuário.
 */
process.env['DATABASE_URL'] = 'pglite:memory'
process.env['PAINEL_SEM_LOGIN'] = '1'
process.env['ANTHROPIC_API_KEY'] = ''

const tokens: Record<string, string> = { ta: 'u-admin', tm: 'u-membro' }
let supabase: Server
let app: Parameters<typeof request>[0]
let ids: { lucas: string; outra: string; ideia: string }

beforeAll(async () => {
  supabase = createServer((req, res) => {
    const t = (req.headers.authorization ?? '').replace('Bearer ', '')
    if (req.url === '/auth/v1/user' && tokens[t]) {
      res.writeHead(200)
      res.end(JSON.stringify({ id: tokens[t], email: `${t}@x.com` }))
    } else {
      res.writeHead(401)
      res.end('{"msg":"bad jwt"}')
    }
  }).listen(0)
  await new Promise((ok) => supabase.once('listening', ok))
  process.env['SUPABASE_URL'] = `http://127.0.0.1:${(supabase.address() as AddressInfo).port}`
  process.env['SUPABASE_SECRET_KEY'] = 'sb_secret_teste'

  const { run, db } = await import('../src/servidor/db/client')
  const { sql } = await import('drizzle-orm')
  for (const f of ['0000_inicial.sql', '0001_usuarios.sql', '0002_persona_por_usuario.sql'])
    for (const st of readFileSync(`drizzle/${f}`, 'utf8').split('--> statement-breakpoint')) if (st.trim()) await run(sql.raw(st))
  const s = await import('../src/servidor/db/schema')
  const [a] = await db.insert(s.persona).values({ nome: 'Lucas', ativa: true }).returning()
  const [b] = await db.insert(s.persona).values({ nome: 'Outra' }).returning()
  const [i] = await db.insert(s.ideia).values({ personaId: b!.id, semana: '2026-W42', tipo: 'pauta', titulo: 'x' } as never).returning()
  await db.insert(s.usuario).values([{ id: 'u-membro', email: 'm@x.com' }, { id: 'u-admin', email: 'a@x.com', papel: 'admin' }])
  await db.insert(s.acesso).values({ usuarioId: 'u-membro', personaId: a!.id })
  ids = { lucas: a!.id, outra: b!.id, ideia: i!.id }

  const { montarTudoLocal } = await import('../src/cli/montar')
  montarTudoLocal()
  const { criarApp } = await import('../src/servidor/api/app')
  app = criarApp({ painelAntigo: true })
}, 60_000)

afterAll(async () => {
  supabase?.close()
  const { closeDb } = await import('../src/servidor/db/client')
  await closeDb()
})

const membro = (r: request.Test) => r.set('authorization', 'Bearer tm').set('x-painel', '1')
const admin = (r: request.Test) => r.set('authorization', 'Bearer ta').set('x-painel', '1')

describe('API', () => {
  it('responde saude, documentação e painel antigo', async () => {
    expect((await request(app).get('/api/saude')).body).toEqual({ ok: true })
    const docs = await request(app).get('/docs.json')
    expect(docs.body.paths['/api/creators/{creatorId}']).toBeTruthy()
    expect((await request(app).get('/')).status).toBe(200)
  })

  it('login: sem token vale o admin local; token ruim é 401', async () => {
    expect((await request(app).get('/api/eu')).body).toMatchObject({ papel: 'admin', local: true })
    expect((await request(app).get('/api/eu').set('authorization', 'Bearer lixo')).status).toBe(401)
    expect((await membro(request(app).get('/api/eu'))).body).toMatchObject({ papel: 'membro', personas: [ids.lucas] })
  })

  it('quem muda algo precisa do x-painel', async () => {
    expect((await request(app).post('/api/creators').set('authorization', 'Bearer tm').send({ nome: 'X' })).status).toBe(403)
  })

  it('membro só vê os creators liberados', async () => {
    const r = await membro(request(app).get('/api/creators/atual'))
    expect(r.body.persona.nome).toBe('Lucas')
    expect(r.body.personas.map((p: { nome: string }) => p.nome)).toEqual(['Lucas'])
    expect((await membro(request(app).get(`/api/creators/${ids.outra}`))).status).toBe(403)
    expect((await membro(request(app).get(`/api/ideias/${ids.ideia}`))).status).toBe(403)
    expect((await admin(request(app).get(`/api/ideias/${ids.ideia}`))).status).toBe(200)
  })

  it('valida o corpo (422) e grava quando está certo', async () => {
    expect((await membro(request(app).patch(`/api/creators/${ids.lucas}/sementes/fulano`)).send({ status: 'qualquer' })).status).toBe(422)
    const add = await membro(request(app).post(`/api/creators/${ids.lucas}/sementes`)).send({ texto: '@fulano, @ciclana' })
    expect(add.body.adicionadas).toEqual(['fulano', 'ciclana'])
    expect((await membro(request(app).patch(`/api/creators/${ids.lucas}/sementes/fulano`)).send({ status: 'confirmada' })).status).toBe(200)
  })

  it('membro cria o próprio creator e passa a vê-lo', async () => {
    const r = await membro(request(app).post('/api/creators')).send({ nome: 'Do Membro' })
    expect(r.status).toBe(201)
    expect((await membro(request(app).get('/api/creators/atual'))).body.persona.nome).toBe('Do Membro')
  })

  it('admin: membro não entra; admin lista', async () => {
    expect((await membro(request(app).get('/api/admin/usuarios'))).status).toBe(403)
    expect((await admin(request(app).get('/api/admin/usuarios'))).body.usuarios.length).toBe(2)
  })

  it('painel antigo continua pelas rotas de compatibilidade', async () => {
    const r = await request(app).post('/api/creator/acao').set('x-painel', '1').send({ acao: 'ideia.responder', id: ids.ideia, status: 'aceita' })
    expect(r.body).toEqual({ ok: true })
    expect((await request(app).get(`/api/creator/ideia?id=${ids.ideia}`)).body.status).toBe('aceita')
  })

  it('o contrato do worker pela rede', async () => {
    const run = await membro(request(app).post('/api/worker/abrirColeta')).send({ args: ['watch'] })
    expect(typeof run.body.resultado).toBe('string')
    expect((await membro(request(app).post('/api/worker/salvarCapturas')).send({ args: [run.body.resultado, [{ url: 'https://www.instagram.com/x', pageUrl: 'https://www.instagram.com/x/', kind: 'html', status: 200, body: { blocos: [] }, bodyHash: 'h', capturedAt: Date.now() }]] })).status).toBe(200)
    expect((await membro(request(app).post('/api/worker/processarCapturas')).send({ args: [] })).body.resultado.rawProcessed).toBe(1)
    expect((await membro(request(app).post('/api/worker/salvarCaptura')).send({ args: ['r', { url: 1 }] })).status).toBe(422)
    expect((await membro(request(app).post('/api/worker/naoExiste')).send({ args: [] })).status).toBe(404)
    // creator de outro: barrado
    expect((await membro(request(app).post('/api/worker/contasDaPersona')).send({ args: [ids.outra] })).status).toBe(403)
    expect((await membro(request(app).post('/api/worker/persona')).set('x-persona', ids.lucas).send({ args: [] })).body.resultado.nome).toBe('Lucas')
  })
})

describe('imagens que vêm no pedido', () => {
  it('anota o que falta e para antes de chamar a IA', async () => {
    const { comImagensDoPedido, imagensDoPedido, exigirImagensCompletas, FaltamImagens } = await import('../src/servidor/ia/imagens')
    const { chaveDoPedido } = await import('../src/comum/imagens')
    const erro = await comImagensDoPedido({}, async () => {
      await imagensDoPedido.quadrosDoPost('ABC', 6, 10, 480)
      try {
        exigirImagensCompletas()
      } catch (e) {
        return e
      }
      return null
    })
    expect(erro).toBeInstanceOf(FaltamImagens)
    const pedido = (erro as InstanceType<typeof FaltamImagens>).pedidos[0]!
    const img = { mime: 'image/jpeg' as const, base64: 'x', rotulo: 'quadro em 0,5s' }
    const ok = await comImagensDoPedido({ [chaveDoPedido(pedido)]: { imagens: [img], duracao: 3 } }, async () => {
      const r = await imagensDoPedido.quadrosDoPost('ABC', 6, 10, 480)
      exigirImagensCompletas()
      return r
    })
    expect(ok.imagens).toHaveLength(1)
  })
})
