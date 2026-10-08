import { runSeguindo } from '../collector/following'
import { runWatch } from '../collector/watch'
import { checkTools, pendentesWhisper, transcribeVideos } from '../enricher/whisper'
import { config } from '../shared/config'
import { logger } from '../shared/logger'
import { isStopRequested } from '../shared/stop'
import { atualizarGrafo, contasDaPersona } from './grafo'
import { temApi } from './llm'
import { gerarPauta } from './pauta'
import { exigirPersona } from './persona'
import { rodarTarefa } from './tarefas'
import { referenciasAtivas, sincronizarReferencias } from './referencias'

export const ETAPAS = ['seguindo', 'grafo', 'acompanhar', 'whisper', 'contas', 'encaixe', 'pauta'] as const
export type Etapa = (typeof ETAPAS)[number]
/** etapas que abrem o navegador */
export const ETAPAS_COLETA: Etapa[] = ['seguindo', 'acompanhar']

export interface SemanaOptions {
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
  const p = await exigirPersona()
  let etapas = opts.etapas?.length ? opts.etapas : [...ETAPAS]
  if (opts.semColeta) etapas = etapas.filter((e) => !ETAPAS_COLETA.includes(e))
  console.log(`\n  Semana de ${p.nome}: ${etapas.join(' → ')}\n`)
  const falhas: string[] = []

  for (const etapa of etapas) {
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
        const g = await atualizarGrafo(p.id)
        // referencias de conteudo tambem entram na fila do acompanhar
        await sincronizarReferencias()
        linha(etapa, g.reason ?? `${g.sementes} sementes, mínimo ${g.minimo} em comum → ${g.contas} contas; ${g.acompanhadas} acompanhadas, ${g.liberadas} liberadas`)
      } else if (etapa === 'acompanhar') {
        // so as contas DESTA persona: a fila "acompanhar" e de todas
        await sincronizarReferencias()
        const permitidos = contasDaPersona(p.id, referenciasAtivas(p.id))
        if (permitidos.length === 0) linha(etapa, 'esta persona não tem contas no grafo nem referências ativas')
        for (let i = 0; i < config.SEMANA_RODADAS_ACOMPANHAR && permitidos.length; i++) {
          const r = await runWatch({ force: opts.force, permitidos })
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
          const autores = contasDaPersona(p.id, referenciasAtivas(p.id))
          const fila = { autores, somenteAutores: true, desdeDias: config.JANELA_DIAS }
          const w = await transcribeVideos(config.WHISPER_POR_CICLO, fila)
          const resta = await pendentesWhisper(fila)
          linha(etapa, `${w.transcribed} transcritos, ${w.empty} sem fala, ${w.failed} falharam; ${resta} reels da janela ainda na fila${resta ? ' (o ciclo parou antes ou alguns falharam: rode de novo)' : ''}`)
        }
      } else if (!temApi()) {
        linha(etapa, 'sem ANTHROPIC_API_KEY: faça esta etapa pelo painel (copiar prompt / colar resposta)')
        falhas.push(`${etapa}: sem chave de API`)
      } else if (etapa === 'contas' || etapa === 'encaixe') {
        const r = await rodarTarefa(etapa)
        linha(etapa, r.motivo ?? `${r.gravados} avaliados em ${r.lotes} lotes${r.invalidos ? `, ${r.invalidos} fora do formato` : ''}${r.extra ? ` ${JSON.stringify(r.extra)}` : ''}`)
      } else if (etapa === 'pauta') {
        const r = await gerarPauta({ refazer: opts.refazerPauta })
        linha(etapa, r.motivo ? `${r.motivo}${r.radar ? ` (${r.radar} temas no radar)` : ''}` : `+${r.ideias} ideias na pauta de ${r.semana}; ${r.radar} temas no radar`)
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      logger.error({ etapa, erro: msg }, 'etapa falhou')
      linha(etapa, `FALHOU: ${msg}`)
      falhas.push(`${etapa}: ${msg}`)
    }
  }
  console.log(falhas.length ? `\n  Terminou com ${falhas.length} pendência(s).\n` : '\n  Semana pronta. Veja a aba Pauta do painel.\n')
  return { ok: falhas.length === 0, falhas }
}
