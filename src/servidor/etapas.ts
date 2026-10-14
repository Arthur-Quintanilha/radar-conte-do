import { atualizarGrafo, contasDaPersona as contasDoGrafoDaPersona } from './creator/grafo'
import { temApi } from './creator/llm'
import { gerarPauta } from './creator/pauta'
import { exigirPersona } from './creator/persona'
import { referenciasAtivas, sincronizarReferencias } from './creator/referencias'
import { rodarTarefa } from './creator/tarefas'
import type { EtapaServidor, OpcoesEtapa, PersonaDoCiclo, ResultadoEtapa } from '../comum/porta'

/** As etapas do ciclo que rodam no servidor, com a linha de log já pronta. */

export async function personaDoCiclo(): Promise<PersonaDoCiclo> {
  const p = await exigirPersona()
  return { id: p.id, nome: p.nome }
}

export async function contasDaPersona(personaId: string): Promise<string[]> {
  return contasDoGrafoDaPersona(personaId, await referenciasAtivas(personaId))
}

export async function referenciasDaPersona(personaId: string): Promise<string[]> {
  return referenciasAtivas(personaId)
}

export async function sincronizar(): Promise<void> {
  await sincronizarReferencias()
}

export async function rodarEtapa(nome: EtapaServidor, o: OpcoesEtapa): Promise<ResultadoEtapa> {
  if (nome === 'grafo') {
    const g = await atualizarGrafo(o.personaId)
    // referencias de conteudo tambem entram na fila do acompanhar
    await sincronizarReferencias()
    return {
      linha: g.reason ?? `${g.sementes} sementes, mínimo ${g.minimo} em comum → ${g.contas} contas; ${g.acompanhadas} acompanhadas, ${g.liberadas} liberadas`,
      gravados: g.contas,
    }
  }
  if (!temApi()) return { linha: 'sem ANTHROPIC_API_KEY: faça esta etapa pelo painel (copiar prompt / colar resposta)', gravados: 0, pulou: true }
  if (nome === 'contas' || nome === 'encaixe') {
    const r = await rodarTarefa(nome, { personaId: o.personaId, so: o.so, refazer: o.refazer })
    // classificar pode mudar quem e "consumido": o grafo marca/solta as contas para acompanhar
    if (nome === 'contas' && o.so?.length && r.gravados) await atualizarGrafo(o.personaId)
    return {
      linha: r.motivo ?? `${r.gravados} avaliados em ${r.lotes} lotes${r.invalidos ? `, ${r.invalidos} fora do formato` : ''}${r.extra && Object.keys(r.extra).length ? ` ${JSON.stringify(r.extra)}` : ''}`,
      gravados: r.gravados,
      lotes: r.lotes,
      motivo: r.motivo,
    }
  }
  const r = await gerarPauta({ personaId: o.personaId, refazer: o.refazer, minimo: o.minimo ?? null })
  return {
    linha: r.motivo ? `${r.motivo}${r.radar ? ` (${r.radar} temas no radar)` : ''}` : `+${r.ideias} ideias na pauta de ${r.semana}; ${r.radar} temas no radar`,
    gravados: r.ideias,
  }
}
