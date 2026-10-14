import type { Servidor } from '../comum/porta'
import * as coleta from './coleta'
import { contasDaPersona, personaDoCiclo, referenciasDaPersona, rodarEtapa, sincronizar } from './etapas'
import { temApi } from './creator/llm'

/**
 * O servidor no mesmo processo do worker: o que roda hoje no terminal e no
 * painel local. O app desktop troca por uma implementação HTTP com o mesmo
 * contrato (comum/porta.ts).
 */
export const servidorDireto: Servidor = {
  orcamento: coleta.orcamento,
  abrirColeta: coleta.abrirColeta,
  salvarCaptura: coleta.salvarCaptura,
  fecharColeta: coleta.fecharColeta,
  processarCapturas: coleta.processarCapturas,
  filaAcompanhar: coleta.filaAcompanhar,
  contaPorUsername: coleta.contaPorUsername,
  marcarVisitada: coleta.marcarVisitada,
  aplicarPerfil: coleta.aplicarPerfil,
  filaSeguindo: coleta.filaSeguindo,
  marcarSemente: coleta.marcarSemente,
  midiasParaBaixar: coleta.midiasParaBaixar,
  midiaBaixada: coleta.midiaBaixada,
  midiaFalhou: coleta.midiaFalhou,
  legendasSemTexto: coleta.legendasSemTexto,
  videosSemTranscricao: coleta.videosSemTranscricao,
  gravarTranscricao: coleta.gravarTranscricao,
  apagarTranscricoesWhisper: coleta.apagarTranscricoesWhisper,
  persona: personaDoCiclo,
  contasDaPersona,
  referenciasDaPersona,
  sincronizarReferencias: sincronizar,
  temIA: async () => temApi(),
  etapa: rodarEtapa,
}
