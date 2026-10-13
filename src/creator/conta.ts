import { runSeguindo } from '../collector/following'
import { runWatch } from '../collector/watch'
import { checkTools, transcribeVideos } from '../enricher/whisper'
import { config } from '../shared/config'
import { atualizarGrafo } from './grafo'
import { temApi } from './llm'
import { exigirPersona, normalizarUsername, usernameValido } from './persona'
import { referenciasAtivas, sincronizarReferencias } from './referencias'
import { rodarTarefa } from './tarefas'

/**
 * As etapas do ciclo para UMA conta, para atualizar so ela sem rodar a lista
 * inteira. "atualizar" = visitar, transcrever, classificar (se for do grafo) e
 * avaliar os posts, nessa ordem.
 */
export const ACOES_CONTA = ['visitar', 'transcrever', 'classificar', 'avaliar', 'seguindo', 'atualizar'] as const
export type AcaoConta = (typeof ACOES_CONTA)[number]

export async function rodarConta(usuario: string, acao: string): Promise<string[]> {
  const u = normalizarUsername(usuario)
  if (!usernameValido(u)) throw new Error(`usuario invalido: ${usuario}`)
  if (!(ACOES_CONTA as readonly string[]).includes(acao)) throw new Error(`acao: ${ACOES_CONTA.join(' | ')}`)
  const p = await exigirPersona()
  const linhas: string[] = []
  // referencia nao e classificada: voce ja disse que ela e fonte de conteudo
  const ehReferencia = (await referenciasAtivas(p.id)).includes(u)
  const etapas: AcaoConta[] = acao === 'atualizar' ? (ehReferencia ? ['visitar', 'transcrever', 'avaliar'] : ['visitar', 'transcrever', 'classificar', 'avaliar']) : [acao as AcaoConta]

  for (const etapa of etapas) {
    if (etapa === 'visitar') {
      // referencia recem-cadastrada ainda nao tem linha de autor: cria antes
      await sincronizarReferencias()
      const r = await runWatch({ username: u, force: true })
      linhas.push(`[visitar] ${r.status === 'ok' ? `${r.posts} posts vistos` : r.reason ?? r.status}`)
      if (r.status === 'failed' || r.status === 'aborted') break
    } else if (etapa === 'transcrever') {
      const t = await checkTools()
      if (!t.ffmpeg.ok || !t.whisper.ok) {
        linhas.push('[transcrever] ffmpeg ou whisper não instalado: pulando')
        continue
      }
      const w = await transcribeVideos(0, { autores: [u], somenteAutores: true, desdeDias: config.JANELA_DIAS })
      linhas.push(`[transcrever] ${w.transcribed} transcritos, ${w.empty} sem fala, ${w.failed} falharam`)
    } else if (etapa === 'classificar' || etapa === 'avaliar') {
      if (!temApi()) {
        linhas.push(`[${etapa}] sem ANTHROPIC_API_KEY: pulando`)
        continue
      }
      const r = await rodarTarefa(etapa === 'classificar' ? 'contas' : 'encaixe', { personaId: p.id, so: [u], refazer: etapa === 'classificar' })
      const nada = etapa === 'classificar' ? 'não é conta do grafo desta persona, ou ainda não foi visitada' : 'nenhum post novo desta conta na janela para avaliar'
      linhas.push(`[${etapa}] ${r.gravados ? `${r.gravados} ${etapa === 'classificar' ? 'classificada' : 'posts avaliados'}` : r.motivo && r.lotes ? r.motivo : nada}`)
      // classificar pode mudar quem e "consumido": o grafo marca/solta as contas para acompanhar
      if (etapa === 'classificar' && r.gravados) await atualizarGrafo()
    } else if (etapa === 'seguindo') {
      const r = await runSeguindo({ username: u, force: true })
      const s = r.sementes[0]
      linhas.push(`[seguindo] ${s ? (s.erro ? `@${u}: ${s.erro}` : `@${u}: ${s.contas} contas`) : r.reason ?? r.status}`)
      if (s && !s.erro) {
        const g = await atualizarGrafo()
        linhas.push(`[grafo] ${g.reason ?? `${g.contas} contas no grafo`}`)
      }
    }
  }
  return linhas
}
