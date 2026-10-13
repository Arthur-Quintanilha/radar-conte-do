import type { IncomingMessage, ServerResponse } from 'node:http'
import { detalheIdeia, loadCreator } from '../creator/painel'
import { corrigirPapel } from '../creator/grafo'
import { adotarRadar, aplicarPauta, dispensarRadar, montarPauta, responderIdeia } from '../creator/pauta'
import { adicionarSementes, atualizarPersona, criarPersona, exigirPersona, salvarTerritorio, setStatusSemente } from '../creator/persona'
import { aplicar, corrigirEncaixe, montarContas, montarEncaixe, montarTerritorio } from '../creator/tarefas'
import { estimarTokens } from '../llm/json'
import { adicionarReferencias, setStatusReferencia } from '../creator/referencias'
import { aplicarRoteiro, apagarRoteiros, editarRoteiro, salvarEdicao, gerarRoteiro, listarRoteiros, marcarRoteiro, montarRoteiro, perguntaDoAngulo, textoRoteiro } from '../creator/roteiro'
import { modeloPauta, temApi } from '../creator/llm'
import { COMANDOS, estadoJob, iniciarJob, pararJob, personaDaRetomada, retomarJob } from './jobs'

import { json, lerJson } from './http'
import { darAcesso, escolherPersona, personaAtualDe, personaDaIdeia, personaDoRoteiro, personasDe, podeVer, type Quem } from '../web/usuarios'

class Proibido extends Error {}

/** Para quem nao e admin: so os creators liberados. Sem id, vale o creator que a pessoa esta vendo. */
async function exigirAcesso(quem: Quem, personaId: string | null | undefined): Promise<void> {
  if (quem.papel === 'admin') return
  const id = personaId ?? (await personaAtualDe(quem))
  if (!(await podeVer(quem, id))) throw new Proibido('voce nao tem acesso a esse creator')
}

/** De que creator e o que essa acao mexe. */
async function personaDaAcao(acao: string | undefined, b: Record<string, unknown>): Promise<string | null | undefined> {
  if (!acao) return undefined
  if (acao === 'ideia.responder' || acao.startsWith('radar.') || ['roteiro.gerar', 'roteiro.prompt', 'roteiro.colar', 'roteiro.apagar', 'roteiro.salvar'].includes(acao))
    return (await personaDaIdeia(String(b['id']))) ?? '-'
  if (acao === 'roteiro.editar' || acao === 'roteiro.status') return (await personaDoRoteiro(String(b['roteiro']))) ?? '-'
  return s(b['persona'])
}

const s = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

/** Rotas /api/creator/*. Devolve false quando a rota nao e dela. */
export async function handleCreator(req: IncomingMessage, res: ServerResponse, url: URL, quem: Quem): Promise<boolean> {
  const rota = url.pathname
  if (!rota.startsWith('/api/creator')) return false

  // todo POST exige o cabecalho proprio: forca preflight de CORS, que este servidor nao responde
  if (req.method === 'POST' && req.headers['x-painel'] !== '1') {
    json(res, 403, { erro: 'proibido' })
    return true
  }

  try {
    if (rota === '/api/creator' && req.method === 'GET') {
      const permitidas = await personasDe(quem)
      const pedida = url.searchParams.get('persona') || (await personaAtualDe(quem))
      if (permitidas) {
        if (pedida && !permitidas.includes(pedida)) throw new Proibido('voce nao tem acesso a esse creator')
        if (!pedida) {
          json(res, 200, { personas: [], persona: null })
          return true
        }
      }
      const dados = await loadCreator(pedida, url.searchParams.get('semana'), { visao: url.searchParams.get('visao'), dia: url.searchParams.get('dia') })
      if (permitidas) dados.personas = dados.personas.filter((p: { id: string }) => permitidas.includes(p.id))
      json(res, 200, dados)
      return true
    }

    if (rota === '/api/creator/ideia' && req.method === 'GET') {
      await exigirAcesso(quem, (await personaDaIdeia(url.searchParams.get('id') ?? '')) ?? '-')
      const d = await detalheIdeia(url.searchParams.get('id') ?? '')
      if (!d) json(res, 404, { erro: 'ideia nao encontrada' })
      else {
        const roteiros = (await listarRoteiros(d.id)).map((r) => ({ ...r, textoPadrao: textoRoteiro(r.conteudo) }))
        json(res, 200, { ...d, pergunta: perguntaDoAngulo(d.angulo), roteiros, roteiroApi: temApi(), roteiroModelo: modeloPauta() })
      }
      return true
    }

    if (rota === '/api/creator/job') {
      if (req.method === 'GET') {
        // o log de uma etapa de outro creator nao aparece para quem nao o acessa
        const job = estadoJob()
        const visivel = !job?.personaId || (await podeVer(quem, job.personaId))
        json(res, 200, { job: visivel ? job : job ? { ...job, saida: [], rotulo: 'Etapa de outro creator' } : null, comandos: COMANDOS })
      }
      else {
        // as etapas rodam sobre o creator que quem clicou esta vendo
        const b = await lerJson(req, 2_000)
        const minha = s(b['persona']) || (await personaAtualDe(quem))
        if (!minha) throw new Error('escolha um creator no topo')
        await exigirAcesso(quem, minha)
        if (b['retomar']) {
          const dono = personaDaRetomada()
          const r = dono && dono !== minha ? { ok: false, erro: 'a execução parada é de outro creator: escolha ele no topo para continuar' } : retomarJob()
          json(res, r.ok ? 200 : 409, r)
          return true
        }
        if (b['parar']) {
          const dono = personaDaRetomada(true)
          if (dono && !(await podeVer(quem, dono))) throw new Proibido('essa execução é de um creator que você não acessa')
        }
        const r = b['parar'] ? { ok: pararJob() } : iniciarJob(String(b['cmd'] ?? ''), s(b['conta']), b['minimo'] ? Number(b['minimo']) : null, minha)
        json(res, r.ok ? 200 : 409, r)
      }
      return true
    }

    // fluxo manual: o painel monta o prompt, voce leva para a LLM e cola a resposta
    if (rota === '/api/creator/tarefa') {
      const tipo = req.method === 'GET' ? url.searchParams.get('tipo') : null
      if (req.method === 'GET') {
        const p = await exigirPersona(url.searchParams.get('persona') || (await personaAtualDe(quem)) || undefined)
        await exigirAcesso(quem, p.id)
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
      const p = await exigirPersona(s(b['persona']) || (await personaAtualDe(quem)) || undefined)
      await exigirAcesso(quem, p.id)
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
      // sem persona no pedido, vale o creator que essa pessoa esta vendo (nao o de outro login)
      const pid = s(b['persona']) || (await personaAtualDe(quem)) || undefined
      if (acao !== 'persona.criar') await exigirAcesso(quem, await personaDaAcao(acao, b))
      switch (acao) {
        case 'persona.criar': {
          const nome = s(b['nome'])?.trim()
          if (!nome) throw new Error('nome obrigatorio')
          const p = await criarPersona(nome, s(b['handle']))
          // quem cria ja tem acesso ao que criou (o admin ve tudo de qualquer jeito)
          await darAcesso(quem, p.id)
          await escolherPersona(quem, p.id)
          json(res, 200, { ok: true, id: p.id })
          return true
        }
        case 'persona.ativar':
          await escolherPersona(quem, String(s(b['persona'])))
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
          const r = await aplicarRoteiro(String(b['id']), s(b['texto']) ?? '', 'manual', { resposta: m.resposta, pedido: m.pedido, formatoDe: m.formatoDe, peca: m.peca })
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
    json(res, error instanceof Proibido ? 403 : 400, { erro: error instanceof Error ? error.message : String(error) })
  }
  return true
}
