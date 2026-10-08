import type { IncomingMessage, ServerResponse } from 'node:http'
import { detalheIdeia, loadCreator } from '../creator/painel'
import { corrigirPapel } from '../creator/grafo'
import { adotarRadar, aplicarPauta, dispensarRadar, montarPauta, responderIdeia } from '../creator/pauta'
import { adicionarSementes, ativarPersona, atualizarPersona, criarPersona, exigirPersona, salvarTerritorio, setStatusSemente } from '../creator/persona'
import { aplicar, corrigirEncaixe, montarContas, montarEncaixe, montarTerritorio } from '../creator/tarefas'
import { estimarTokens } from '../llm/prompt'
import { adicionarReferencias, setStatusReferencia } from '../creator/referencias'
import { aplicarRoteiro, apagarRoteiros, editarRoteiro, salvarEdicao, gerarRoteiro, listarRoteiros, marcarRoteiro, montarRoteiro, perguntaDoAngulo, textoRoteiro } from '../creator/roteiro'
import { modeloPauta, temApi } from '../creator/llm'
import { COMANDOS, estadoJob, iniciarJob, pararJob } from './jobs'

const json = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

async function lerJson(req: IncomingMessage, max: number): Promise<Record<string, unknown>> {
  let corpo = ''
  for await (const parte of req) {
    corpo += String(parte)
    if (corpo.length > max) throw new Error(`corpo maior que ${max} caracteres`)
  }
  return JSON.parse(corpo || '{}') as Record<string, unknown>
}

const s = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

/** Rotas /api/creator/*. Devolve false quando a rota nao e dela. */
export async function handleCreator(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  const rota = url.pathname
  if (!rota.startsWith('/api/creator')) return false

  // todo POST exige o cabecalho proprio: forca preflight de CORS, que este servidor nao responde
  if (req.method === 'POST' && req.headers['x-painel'] !== '1') {
    json(res, 403, { erro: 'proibido' })
    return true
  }

  try {
    if (rota === '/api/creator' && req.method === 'GET') {
      json(res, 200, await loadCreator(url.searchParams.get('persona'), url.searchParams.get('semana'), { visao: url.searchParams.get('visao'), dia: url.searchParams.get('dia') }))
      return true
    }

    if (rota === '/api/creator/ideia' && req.method === 'GET') {
      const d = await detalheIdeia(url.searchParams.get('id') ?? '')
      if (!d) json(res, 404, { erro: 'ideia nao encontrada' })
      else {
        const roteiros = listarRoteiros(d.id).map((r) => ({ ...r, textoPadrao: textoRoteiro(r.conteudo) }))
        json(res, 200, { ...d, pergunta: perguntaDoAngulo(d.angulo), roteiros, roteiroApi: temApi(), roteiroModelo: modeloPauta() })
      }
      return true
    }

    if (rota === '/api/creator/job') {
      if (req.method === 'GET') json(res, 200, { job: estadoJob(), comandos: COMANDOS })
      else {
        const b = await lerJson(req, 2_000)
        const r = b['parar'] ? { ok: pararJob() } : iniciarJob(String(b['cmd'] ?? ''), s(b['conta']))
        json(res, r.ok ? 200 : 409, r)
      }
      return true
    }

    // fluxo manual: o painel monta o prompt, voce leva para a LLM e cola a resposta
    if (rota === '/api/creator/tarefa') {
      const tipo = req.method === 'GET' ? url.searchParams.get('tipo') : null
      if (req.method === 'GET') {
        const p = await exigirPersona(url.searchParams.get('persona') ?? undefined)
        const refazer = url.searchParams.get('refazer') === '1'
        const m =
          tipo === 'territorio'
            ? montarTerritorio(p)
            : tipo === 'contas'
              ? await montarContas(p, 25, refazer)
              : tipo === 'encaixe'
                ? await montarEncaixe(p, 20, refazer)
                : tipo === 'pauta'
                  ? await montarPauta(p)
                  : null
        if (!m) {
          json(res, 400, { erro: 'tipo: territorio | contas | encaixe | pauta' })
          return true
        }
        json(res, 200, { tipo: m.tipo, itens: m.itens, prompt: m.prompt, motivo: m.motivo, tokens: estimarTokens(m.prompt) })
        return true
      }
      const b = await lerJson(req, 3_000_000)
      const p = await exigirPersona(s(b['persona']))
      const t = s(b['tipo'])
      const texto = s(b['texto']) ?? ''
      const modelo = s(b['modelo']) || 'manual'
      if (t === 'pauta') json(res, 200, await aplicarPauta(p, texto, modelo, undefined, 'mais'))
      else if (t === 'territorio' || t === 'contas' || t === 'encaixe') json(res, 200, await aplicar(t, p, texto, modelo))
      else json(res, 400, { erro: 'tipo invalido' })
      return true
    }

    if (rota === '/api/creator/acao' && req.method === 'POST') {
      const b = await lerJson(req, 200_000)
      const acao = s(b['acao'])
      const pid = s(b['persona'])
      switch (acao) {
        case 'persona.criar': {
          const nome = s(b['nome'])?.trim()
          if (!nome) throw new Error('nome obrigatorio')
          const p = await criarPersona(nome, s(b['handle']))
          json(res, 200, { ok: true, id: p.id })
          return true
        }
        case 'persona.ativar':
          await ativarPersona(String(pid))
          break
        case 'persona.salvar': {
          const ent = b['entrevista']
          await atualizarPersona(String(pid), {
            nome: s(b['nome']),
            handle: b['handle'] === null ? null : s(b['handle']),
            entrevista: ent && typeof ent === 'object' ? (ent as Record<string, string>) : undefined,
          })
          break
        }
        case 'territorio.salvar':
          await salvarTerritorio(String(pid), b['territorio'])
          break
        case 'sementes.add': {
          const p = await exigirPersona(pid)
          json(res, 200, { ok: true, ...(await adicionarSementes(p.id, s(b['texto']) ?? '')) })
          return true
        }
        case 'semente.status': {
          const p = await exigirPersona(pid)
          const st = s(b['status'])
          if (st !== 'confirmada' && st !== 'rejeitada' && st !== 'remover') throw new Error('status invalido')
          await setStatusSemente(p.id, String(b['username']), st)
          break
        }
        case 'referencias.add': {
          const p = await exigirPersona(pid)
          json(res, 200, { ok: true, ...(await adicionarReferencias(p.id, s(b['texto']) ?? '')) })
          return true
        }
        case 'referencia.status': {
          const p = await exigirPersona(pid)
          const st = s(b['status'])
          if (st !== 'ativa' && st !== 'pausada' && st !== 'remover') throw new Error('status invalido')
          await setStatusReferencia(p.id, String(b['username']), st)
          break
        }
        case 'conta.papel': {
          const p = await exigirPersona(pid)
          const papel = s(b['papel']) || null
          if (papel && !['consumido', 'par', 'fora'].includes(papel)) throw new Error('papel invalido')
          await corrigirPapel(p.id, String(b['username']), papel)
          break
        }
        case 'encaixe.corrigir': {
          const p = await exigirPersona(pid)
          const v = s(b['valor']) || null
          if (v && !['dentro', 'radar', 'fora'].includes(v)) throw new Error('encaixe invalido')
          await corrigirEncaixe(p.id, String(b['shortcode']), v, s(b['radarTema']) ?? null)
          break
        }
        case 'ideia.responder': {
          const st = s(b['status'])
          if (st !== 'aceita' && st !== 'recusada' && st !== 'nova') throw new Error('status invalido')
          await responderIdeia(String(b['id']), { status: st, motivo: s(b['motivo']), nota: s(b['nota']) })
          break
        }
        case 'roteiro.gerar': {
          const r = await gerarRoteiro(String(b['id']), { resposta: s(b['resposta']), pedido: s(b['pedido']) })
          json(res, 200, { ok: true, roteiro: r.id, versao: r.versao })
          return true
        }
        case 'roteiro.prompt': {
          const m = await montarRoteiro(String(b['id']), { resposta: s(b['resposta']), pedido: s(b['pedido']), comImagens: false })
          json(res, 200, { ok: true, prompt: m.prompt, tokens: estimarTokens(m.prompt) })
          return true
        }
        case 'roteiro.colar': {
          const m = await montarRoteiro(String(b['id']), { resposta: s(b['resposta']), pedido: s(b['pedido']), comImagens: false })
          const r = await aplicarRoteiro(String(b['id']), s(b['texto']) ?? '', 'manual', { resposta: m.resposta, pedido: m.pedido, formatoDe: m.formatoDe })
          json(res, 200, { ok: true, roteiro: r.id, versao: r.versao })
          return true
        }
        case 'roteiro.apagar': {
          json(res, 200, { ok: true, apagados: await apagarRoteiros(String(b['id'])) })
          return true
        }
        case 'roteiro.salvar': {
          const r = await salvarEdicao(String(b['id']), String(b['roteiro']), b['conteudo'])
          json(res, 200, { ok: true, roteiro: r.id, versao: r.versao })
          return true
        }
        case 'roteiro.editar':
          await editarRoteiro(String(b['roteiro']), s(b['texto']) ?? '')
          break
        case 'roteiro.status': {
          const st = s(b['status'])
          if (st !== 'rascunho' && st !== 'gravado') throw new Error('status invalido')
          await marcarRoteiro(String(b['roteiro']), st)
          break
        }
        case 'radar.adotar':
          await adotarRadar(String(b['id']), b['como'] === 'temas' ? 'temas' : 'pessoal', s(b['detalhe']))
          break
        case 'radar.dispensar':
          await dispensarRadar(String(b['id']))
          break
        default:
          json(res, 400, { erro: `acao desconhecida: ${acao}` })
          return true
      }
      json(res, 200, { ok: true })
      return true
    }

    json(res, 404, { erro: 'rota nao encontrada' })
  } catch (error) {
    json(res, 400, { erro: error instanceof Error ? error.message : String(error) })
  }
  return true
}
