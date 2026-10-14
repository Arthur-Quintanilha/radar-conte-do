import { runSeguindo } from '../coleta/following'
import { runWatch } from '../coleta/watch'
import { checkTools, transcribeVideos } from '../midia/whisper'
import { config } from '../../comum/config'
import { servidor } from '../servidor'

const normalizarUsername = (u: string): string => u.replace(/^@/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/[/?#].*$/, '').trim().toLowerCase()
const usernameValido = (u: string): boolean => /^[a-z0-9._]{1,30}$/.test(u)

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
  const srv = servidor()
  const p = await srv.persona()
  const linhas: string[] = []
  // referencia nao e classificada: voce ja disse que ela e fonte de conteudo
  const ehReferencia = (await srv.referenciasDaPersona(p.id)).includes(u)
  const etapas: AcaoConta[] = acao === 'atualizar' ? (ehReferencia ? ['visitar', 'transcrever', 'avaliar'] : ['visitar', 'transcrever', 'classificar', 'avaliar']) : [acao as AcaoConta]

  for (const etapa of etapas) {
    if (etapa === 'visitar') {
      // referencia recem-cadastrada ainda nao tem linha de autor: cria antes
      await srv.sincronizarReferencias()
      const r = await runWatch({ username: u, force: true })
      linhas.push(`[visitar] ${r.status === 'ok' ? `${r.parse?.postsNew ?? 0} posts novos, ${r.parse?.postsUpdated ?? 0} atualizados` : r.reason ?? r.status}`)
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
      // classificar pode mudar quem e "consumido": o servidor refaz o grafo quando grava
      const r = await srv.etapa(etapa === 'classificar' ? 'contas' : 'encaixe', { personaId: p.id, so: [u], refazer: etapa === 'classificar' })
      if (r.pulou) {
        linhas.push(`[${etapa}] sem ANTHROPIC_API_KEY: pulando`)
        continue
      }
      const nada = etapa === 'classificar' ? 'não é conta do grafo desta persona, ou ainda não foi visitada' : 'nenhum post novo desta conta na janela para avaliar'
      linhas.push(`[${etapa}] ${r.gravados ? `${r.gravados} ${etapa === 'classificar' ? 'classificada' : 'posts avaliados'}` : r.motivo && r.lotes ? r.motivo : nada}`)
    } else if (etapa === 'seguindo') {
      const r = await runSeguindo({ username: u, force: true })
      const s = r.sementes[0]
      linhas.push(`[seguindo] ${s ? (s.erro ? `@${u}: ${s.erro}` : `@${u}: ${s.contas} contas`) : r.reason ?? r.status}`)
      if (s && !s.erro) {
        const g = await srv.etapa('grafo', { personaId: p.id })
        linhas.push(`[grafo] ${g.linha}`)
      }
    }
  }
  return linhas
}
