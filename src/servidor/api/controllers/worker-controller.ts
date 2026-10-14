import type { Request, Response } from 'express'
import { z, type ZodTypeAny } from 'zod'
import type { CapturaEnviada, Servidor } from '../../../comum/porta'
import * as coleta from '../../coleta'
import { contasDaPersona, personaDoCiclo, referenciasDaPersona, rodarEtapa, sincronizar } from '../../etapas'
import { temApi } from '../../creator/llm'
import { exigirAcesso, personaAtualDe } from '../acesso'
import { conflito, naoEncontrado } from '../erros'
import { quem } from '../middlewares/autenticar'

/**
 * POST /api/worker/:metodo — o contrato worker <-> servidor (comum/porta.ts)
 * pela rede. Cada método tem os argumentos validados e a regra de acesso dele;
 * o resultado é o mesmo da chamada no mesmo processo.
 *
 * O cabeçalho x-persona diz para que creator o worker está rodando (o que a
 * pessoa escolheu ao clicar); sem ele, vale o que ela está vendo.
 */

const texto = z.string().max(500)
const kind = z.enum(['explore_grid', 'graphql', 'media_info', 'comments', 'profile', 'feed', 'search', 'following', 'other', 'html'])
const captura = z.object({
  url: z.string().max(4000),
  pageUrl: z.string().max(4000),
  kind,
  status: z.number().int(),
  body: z.unknown(),
  bodyHash: z.string().max(128),
  capturedAt: z.number(),
})
const resumoColeta = z.object({
  status: z.enum(['ok', 'aborted', 'failed', 'skipped']),
  cardsSeen: z.number().int().optional(),
  postsOpened: z.number().int().optional(),
  responsesCaptured: z.number().int().optional(),
  abortReason: z.string().max(2000).nullable().optional(),
})
const perfil = z.object({
  username: z.string(),
  igUserId: z.string().optional(),
  fullName: z.string().optional(),
  isVerified: z.boolean().optional(),
  followersCount: z.number().optional(),
  biography: z.string().optional(),
  category: z.string().optional(),
  source: z.enum(['graphql', 'json', 'regex', 'meta']),
})
const dadosSemente = z.object({
  fullName: z.string().optional(),
  biography: z.string().optional(),
  followingCount: z.number().int().optional(),
  privada: z.boolean().optional(),
  erro: z.string().max(500).nullable().optional(),
  tentativaEm: z.number().optional(),
  coletadaEm: z.number().optional(),
})
const fila = z.object({ autores: z.array(z.string()).optional(), somenteAutores: z.boolean().optional(), desdeDias: z.number().optional() })
const limite = z.number().int().min(0).max(20_000)
const id = z.string().min(1).max(64)
const tipoColeta = z.enum(['watch', 'following'])
const opcoesEtapa = z.object({ personaId: z.string(), so: z.array(z.string()).optional(), refazer: z.boolean().optional(), minimo: z.number().int().nullable().optional() })

type Contexto = { req: Request; persona: () => Promise<string> }
interface Metodo {
  args: ZodTypeAny
  rodar: (args: never[], c: Contexto) => Promise<unknown>
}
const m = <A extends unknown[]>(args: z.ZodType<A, z.ZodTypeDef, unknown>, rodar: (a: A, c: Contexto) => Promise<unknown>): Metodo => ({ args, rodar: rodar as unknown as Metodo['rodar'] })

/** confere o acesso ao creator antes de rodar */
const doCreator = async (c: Contexto, personaId: string): Promise<void> => exigirAcesso(quem(c.req), personaId)

const METODOS: { [K in keyof Servidor]: Metodo } = {
  orcamento: m(z.tuple([tipoColeta]), ([t]) => coleta.orcamento(t)),
  abrirColeta: m(z.tuple([tipoColeta]), ([t]) => coleta.abrirColeta(t)),
  salvarCaptura: m(z.tuple([id, captura]), ([run, cap]) => coleta.salvarCaptura(run, cap as CapturaEnviada)),
  salvarCapturas: m(z.tuple([id, z.array(captura).max(200)]), ([run, caps]) => coleta.salvarCapturas(run, caps as CapturaEnviada[])),
  fecharColeta: m(z.tuple([id, resumoColeta]), ([run, r]) => coleta.fecharColeta(run, r)),
  processarCapturas: m(z.tuple([]), () => coleta.processarCapturas()),
  filaAcompanhar: m(z.tuple([limite, z.array(z.string()).optional()]), ([l, p]) => coleta.filaAcompanhar(l, p)),
  contaPorUsername: m(z.tuple([texto]), ([u]) => coleta.contaPorUsername(u)),
  marcarVisitada: m(z.tuple([id]), ([a]) => coleta.marcarVisitada(a)),
  aplicarPerfil: m(z.tuple([id, perfil]), ([a, f]) => coleta.aplicarPerfil(a, f)),
  filaSeguindo: m(z.tuple([limite]), async ([l], c) => coleta.filaSeguindo(l, await c.persona())),
  marcarSemente: m(z.tuple([texto, dadosSemente]), ([u, d]) => coleta.marcarSemente(u, d)),
  midiasParaBaixar: m(z.tuple([limite]), ([l]) => coleta.midiasParaBaixar(l)),
  midiaBaixada: m(z.tuple([id]), ([x]) => coleta.midiaBaixada(x)),
  midiaFalhou: m(z.tuple([id, z.string().max(2000)]), ([x, e]) => coleta.midiaFalhou(x, e)),
  legendasSemTexto: m(z.tuple([limite]), ([l]) => coleta.legendasSemTexto(l)),
  videosSemTranscricao: m(z.tuple([texto, fila, limite]), ([mod, f, l]) => coleta.videosSemTranscricao(mod, f, l)),
  gravarTranscricao: m(z.tuple([id, texto, z.string().max(200_000)]), ([p, mod, t]) => coleta.gravarTranscricao(p, mod, t)),
  apagarTranscricoesWhisper: m(z.tuple([]), async (_a, c) => {
    if (quem(c.req).papel !== 'admin') throw conflito('so admin apaga as transcricoes')
    return coleta.apagarTranscricoesWhisper()
  }),
  persona: m(z.tuple([]), async (_a, c) => personaDoCiclo(await c.persona())),
  contasDaPersona: m(z.tuple([id]), async ([p], c) => {
    await doCreator(c, p)
    return contasDaPersona(p)
  }),
  referenciasDaPersona: m(z.tuple([id]), async ([p], c) => {
    await doCreator(c, p)
    return referenciasDaPersona(p)
  }),
  sincronizarReferencias: m(z.tuple([]), () => sincronizar()),
  temIA: m(z.tuple([]), async () => temApi()),
  etapa: m(z.tuple([z.enum(['grafo', 'contas', 'encaixe', 'pauta']), opcoesEtapa]), async ([nome, o], c) => {
    await doCreator(c, o.personaId)
    return rodarEtapa(nome, o)
  }),
}

export const metodosDoWorker = Object.keys(METODOS)

export async function chamar(req: Request, res: Response): Promise<void> {
  const nome = String(req.params['metodo'])
  const metodo = (METODOS as Record<string, Metodo | undefined>)[nome]
  if (!metodo) throw naoEncontrado(`metodo desconhecido: ${nome}`)
  const args = metodo.args.parse((req.body as { args?: unknown } | undefined)?.args ?? [])
  const persona = async (): Promise<string> => {
    const q = quem(req)
    const pedida = typeof req.headers['x-persona'] === 'string' && req.headers['x-persona'] ? req.headers['x-persona'] : await personaAtualDe(q)
    if (!pedida) throw conflito('escolha um creator antes de rodar')
    await exigirAcesso(q, pedida)
    return pedida
  }
  const resultado = await metodo.rodar(args as never[], { req, persona })
  res.json({ resultado: resultado ?? null })
}
