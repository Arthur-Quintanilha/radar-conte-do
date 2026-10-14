import { runSeguindo } from '../coleta/following'
import { runWatch } from '../coleta/watch'
import { checkTools, pendentesWhisper, transcribeVideos } from '../midia/whisper'
import { config } from '../../comum/config'
import { logger } from '../../comum/logger'
import { isStopRequested } from '../../comum/stop'
import { gravarCiclo, type EstadoCiclo } from './ciclo'
import { servidor } from '../servidor'

export const ETAPAS = ['seguindo', 'grafo', 'acompanhar', 'whisper', 'contas', 'encaixe', 'pauta'] as const
export type Etapa = (typeof ETAPAS)[number]
/** etapas que abrem o navegador */
export const ETAPAS_COLETA: Etapa[] = ['seguindo', 'acompanhar']

export interface SemanaOptions {
  /** minimo de ideias na pauta; vazio = a IA decide */
  minimo?: number | null
  etapas?: Etapa[]
  semColeta?: boolean
  refazerPauta?: boolean
  force?: boolean
}

const linha = (etapa: string, texto: string) => console.log(`  [${etapa}] ${texto}`)

/**
 * O ciclo semanal inteiro da persona ativa, na ordem do plano:
 * seguindo -> grafo -> acompanhar -> whisper -> contas -> encaixe -> pauta.
 * Uma etapa que falha nao derruba as seguintes: o que der para aproveitar,
 * aproveita, e o resumo diz o que ficou para tras.
 */
export async function runSemana(opts: SemanaOptions = {}): Promise<{ ok: boolean; falhas: string[] }> {
  const srv = servidor()
  const p = await srv.persona()
  let etapas = opts.etapas?.length ? opts.etapas : [...ETAPAS]
  if (opts.semColeta) etapas = etapas.filter((e) => !ETAPAS_COLETA.includes(e))
  console.log(`\n  Semana de ${p.nome}: ${etapas.join(' → ')}\n`)
  const falhas: string[] = []
  // a etapa so conta como feita quando termina sem erro; parou ou falhou, o "continuar" refaz ela
  const estado: EstadoCiclo = { personaId: p.id, etapas, feitas: [], minimo: opts.minimo ?? null, refazerPauta: Boolean(opts.refazerPauta), inicio: Date.now(), fim: null }
  gravarCiclo(estado)

  for (const etapa of etapas) {
    const falhasAntes = falhas.length
    if (isStopRequested()) {
      linha(etapa, 'STOP solicitado: parando aqui')
      falhas.push(`${etapa}: STOP`)
      break
    }
    try {
      if (etapa === 'seguindo') {
        for (let i = 0; i < 6; i++) {
          const r = await runSeguindo({ force: opts.force })
          if (r.status === 'skipped') {
            linha(etapa, r.reason ?? 'nada a fazer')
            break
          }
          for (const s of r.sementes) linha(etapa, `@${s.semente}: ${s.contas} contas${s.erro ? ` (${s.erro})` : ''}`)
          if (r.status !== 'ok') {
            linha(etapa, `sessao ${r.status}: ${r.reason ?? ''}`)
            if (r.status === 'failed') falhas.push(`seguindo: ${r.reason}`)
            break
          }
        }
      } else if (etapa === 'grafo') {
        linha(etapa, (await srv.etapa('grafo', { personaId: p.id })).linha)
      } else if (etapa === 'acompanhar') {
        // so as contas DESTA persona: a fila "acompanhar" e de todas
        await srv.sincronizarReferencias()
        const permitidos = await srv.contasDaPersona(p.id)
        if (permitidos.length === 0) linha(etapa, 'esta persona não tem contas no grafo nem referências ativas')
        // visita TODOS os perfis da persona: cada rodada e uma sessao do navegador (que fecha no
        // SESSION_MAX_MINUTES); a seguinte pega quem sobrou. Para quando nao ha mais ninguem.
        // SEMANA_RODADAS_ACOMPANHAR > 0 volta a limitar o numero de rodadas.
        const maxRodadas = config.SEMANA_RODADAS_ACOMPANHAR > 0 ? config.SEMANA_RODADAS_ACOMPANHAR : 50
        for (let i = 0; i < maxRodadas && permitidos.length; i++) {
          if (isStopRequested()) break
          const r = await runWatch({ force: opts.force, permitidos, limite: permitidos.length })
          if (r.status === 'skipped') {
            linha(etapa, r.reason ?? 'ninguém para visitar')
            break
          }
          linha(etapa, `${r.visitados.length} perfis, ${r.parse?.postsNew ?? 0} posts novos${r.reason ? ` (${r.reason})` : ''}`)
          if (r.status !== 'ok') {
            if (r.status === 'failed') falhas.push(`acompanhar: ${r.reason}`)
            break
          }
        }
      } else if (etapa === 'whisper') {
        const t = await checkTools()
        if (!t.ffmpeg.ok || !t.whisper.ok) linha(etapa, 'ffmpeg ou whisper não instalado: pulando (npm run whisper -- --check)')
        else {
          // so os reels que podem virar pauta: contas desta persona, dentro da janela
          const autores = await srv.contasDaPersona(p.id)
          const fila = { autores, somenteAutores: true, desdeDias: config.JANELA_DIAS }
          const w = await transcribeVideos(config.WHISPER_POR_CICLO, fila)
          const resta = await pendentesWhisper(fila)
          linha(etapa, `${w.transcribed} transcritos, ${w.empty} sem fala, ${w.failed} falharam; ${resta} reels da janela ainda na fila${resta ? ' (o ciclo parou antes ou alguns falharam: rode de novo)' : ''}`)
        }
      } else if (etapa === 'contas' || etapa === 'encaixe' || etapa === 'pauta') {
        const r = await srv.etapa(etapa, { personaId: p.id, refazer: etapa === 'pauta' ? opts.refazerPauta : undefined, minimo: opts.minimo ?? null })
        linha(etapa, r.linha)
        if (r.pulou) falhas.push(`${etapa}: sem chave de API`)
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      logger.error({ etapa, erro: msg }, 'etapa falhou')
      linha(etapa, `FALHOU: ${msg}`)
      falhas.push(`${etapa}: ${msg}`)
    }
    if (falhas.length === falhasAntes && !isStopRequested()) {
      estado.feitas.push(etapa)
      gravarCiclo(estado)
    }
  }
  estado.fim = Date.now()
  gravarCiclo(estado)
  console.log(falhas.length ? `\n  Terminou com ${falhas.length} pendência(s).\n` : '\n  Semana pronta. Veja a aba Pauta do painel.\n')
  return { ok: falhas.length === 0, falhas }
}
