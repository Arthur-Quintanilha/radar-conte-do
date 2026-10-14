import { atenderPedidos, type ImagensFornecidas, type PedidoImagens } from '../comum/imagens'
import type { CapturaEnviada, ResultadoEtapa, Servidor } from '../comum/porta'
import { logger } from '../comum/logger'
import { imagensLocais } from './midia/quadros'

/**
 * O contrato com o servidor pela rede: cada método vira POST /api/worker/<nome>.
 * As capturas vão em lotes, e as etapas de IA que pedem imagens recebem as
 * imagens extraídas da pasta local (o servidor não guarda arquivo nenhum).
 */
export interface OpcoesHttp {
  /** ex.: https://api.radar.kxp.com.br */
  url: string
  /** token do login (o app renova); null = sem login (painel local) */
  token: () => Promise<string | null> | string | null
  /** creator desta execução (o que a pessoa escolheu ao clicar) */
  persona?: () => string | null
  /** espera máxima por pedido, ms */
  tempoLimite?: number
}

const LOTE = 25
const LOTE_BYTES = 6 * 1024 * 1024
/** uma etapa de IA para no máximo tantas vezes pedindo imagens (uma por lote) */
const MAX_IDAS = 200

export class ErroDoServidor extends Error {
  constructor(
    readonly status: number,
    mensagem: string,
    readonly corpo: unknown,
  ) {
    super(mensagem)
    this.name = 'ErroDoServidor'
  }
}

export function servidorHttp(o: OpcoesHttp): Servidor {
  const base = o.url.replace(/\/+$/, '')
  let fila: { runId: string; capturas: CapturaEnviada[]; bytes: number } | null = null

  async function chamar<T>(metodo: string, args: unknown[], imagens?: ImagensFornecidas): Promise<T> {
    const token = await o.token()
    const persona = o.persona?.()
    const r = await fetch(`${base}/api/worker/${metodo}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-painel': '1',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(persona ? { 'x-persona': persona } : {}),
      },
      body: JSON.stringify({ args, ...(imagens ? { imagens } : {}) }),
      signal: AbortSignal.timeout(o.tempoLimite ?? 15 * 60_000),
    })
    const corpo = (await r.json().catch(() => ({}))) as { resultado?: T; erro?: string }
    if (!r.ok) throw new ErroDoServidor(r.status, `servidor (${metodo}): ${corpo.erro ?? `HTTP ${r.status}`}`, corpo)
    return corpo.resultado as T
  }

  /** manda o que estiver acumulado antes de qualquer outra chamada */
  async function descarregar(): Promise<void> {
    if (!fila || !fila.capturas.length) return
    const { runId, capturas } = fila
    fila = null
    await chamar('salvarCapturas', [runId, capturas])
  }

  const direto =
    <A extends unknown[], R>(metodo: string) =>
    async (...args: A): Promise<R> => {
      await descarregar()
      return chamar<R>(metodo, args)
    }

  /** etapa de IA: se o servidor pedir imagens, extrai da pasta local e chama de novo */
  async function etapa(...args: Parameters<Servidor['etapa']>): Promise<ResultadoEtapa> {
    await descarregar()
    let imagens: ImagensFornecidas | undefined
    let total: ResultadoEtapa | null = null
    for (let ida = 0; ida < MAX_IDAS; ida++) {
      const r = await chamar<ResultadoEtapa>('etapa', args, imagens)
      total = total ? { ...r, gravados: total.gravados + r.gravados, lotes: (total.lotes ?? 0) + (r.lotes ?? 0) } : r
      if (!r.faltam?.length) break
      logger.info({ etapa: args[0], pedidos: r.faltam.length }, 'mandando as imagens dos posts')
      imagens = await atenderPedidos(imagensLocais, r.faltam as PedidoImagens[])
    }
    const { faltam: _f, ...fim } = total!
    return fim
  }

  return {
    orcamento: direto('orcamento'),
    abrirColeta: direto('abrirColeta'),
    async salvarCaptura(runId, c) {
      if (fila && fila.runId !== runId) await descarregar()
      fila ??= { runId, capturas: [], bytes: 0 }
      fila.capturas.push(c)
      fila.bytes += JSON.stringify(c.body ?? null).length
      if (fila.capturas.length >= LOTE || fila.bytes >= LOTE_BYTES) await descarregar()
    },
    async salvarCapturas(runId, caps) {
      await descarregar()
      for (let i = 0; i < caps.length; i += LOTE) await chamar('salvarCapturas', [runId, caps.slice(i, i + LOTE)])
    },
    fecharColeta: direto('fecharColeta'),
    processarCapturas: direto('processarCapturas'),
    filaAcompanhar: direto('filaAcompanhar'),
    contaPorUsername: direto('contaPorUsername'),
    marcarVisitada: direto('marcarVisitada'),
    aplicarPerfil: direto('aplicarPerfil'),
    filaSeguindo: direto('filaSeguindo'),
    marcarSemente: direto('marcarSemente'),
    midiasParaBaixar: direto('midiasParaBaixar'),
    midiaBaixada: direto('midiaBaixada'),
    midiaFalhou: direto('midiaFalhou'),
    legendasSemTexto: direto('legendasSemTexto'),
    videosSemTranscricao: direto('videosSemTranscricao'),
    gravarTranscricao: direto('gravarTranscricao'),
    apagarTranscricoesWhisper: direto('apagarTranscricoesWhisper'),
    persona: direto('persona'),
    contasDaPersona: direto('contasDaPersona'),
    referenciasDaPersona: direto('referenciasDaPersona'),
    sincronizarReferencias: direto('sincronizarReferencias'),
    temIA: direto('temIA'),
    etapa,
  }
}
