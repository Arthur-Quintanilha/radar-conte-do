import { and, eq, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { author, classification } from '../db/schema'
import { AUTHOR_CLASSES, CONTAS_VERSION, POSTS_VERSION, RELEVANCES, SELECAO_VERSION, authorAnswer, postAnswer, selecaoItem } from './schema'

export interface ImportResult {
  tipo: 'contas' | 'posts' | 'selecao' | null
  gravados: number
  /** so na selecao: contas que a IA acompanhava e sairam da lista */
  removidos?: string[]
  /** ids que nao estao no banco (a LLM inventou ou errou o id) */
  desconhecidos: string[]
  /** itens fora do formato, com o motivo */
  invalidos: { id: string; erro: string }[]
}

/** Tira o JSON do meio do que foi colado: bloco ```json ou o trecho entre { } / [ ]. */
export function extrairJson(texto: string): unknown {
  const bloco = /```(?:json)?\s*([\s\S]*?)```/i.exec(texto)?.[1]
  const candidatos = [bloco, texto].filter((t): t is string => typeof t === 'string')
  for (const c of candidatos) {
    const ini = c.search(/[[{]/)
    if (ini === -1) continue
    const fim = Math.max(c.lastIndexOf(']'), c.lastIndexOf('}'))
    try {
      return JSON.parse(c.slice(ini, fim + 1)) as unknown
    } catch {
      // tenta o proximo candidato
    }
  }
  throw new Error('nao achei uma lista JSON no texto colado. Cole a resposta inteira da LLM, com o bloco ```json')
}

/**
 * Plano B quando o JSON inteiro nao fecha (aspas sem escape numa legenda
 * citada, resposta cortada no limite de tokens): pega cada objeto { } de
 * primeiro nivel que der para ler sozinho e descarta so o quebrado.
 */
export function objetosSoltos(texto: string): Record<string, unknown>[] {
  const fonte = /```(?:json)?\s*([\s\S]*?)(```|$)/i.exec(texto)?.[1] ?? texto
  const achados: Record<string, unknown>[] = []
  let nivel = 0
  let ini = -1
  let emString = false
  let escape = false
  for (let i = 0; i < fonte.length; i++) {
    const c = fonte[i]
    if (emString) {
      if (escape) escape = false
      else if (c === '\\') escape = true
      else if (c === '"') emString = false
      continue
    }
    if (c === '"') emString = true
    else if (c === '{') {
      if (nivel === 0) ini = i
      nivel++
    } else if (c === '}' && nivel > 0) {
      nivel--
      if (nivel === 0 && ini >= 0) {
        try {
          const o = JSON.parse(fonte.slice(ini, i + 1)) as unknown
          if (o && typeof o === 'object' && !Array.isArray(o)) achados.push(o as Record<string, unknown>)
        } catch {
          // objeto quebrado: fica de fora
        }
        ini = -1
      }
    }
  }
  return achados
}

/** A lista de itens: aceita a lista solta ou um objeto com a lista dentro. */
export function extrairLista(texto: string): unknown[] {
  let json: unknown
  try {
    json = extrairJson(texto)
  } catch (error) {
    const soltos = objetosSoltos(texto)
    if (soltos.length) return soltos
    throw error
  }
  if (Array.isArray(json)) return json
  if (json && typeof json === 'object') {
    const dentro = Object.values(json as Record<string, unknown>).find(Array.isArray)
    if (dentro) return dentro
    return [json]
  }
  throw new Error('nao achei uma lista JSON no texto colado. Cole a resposta inteira da LLM, com o bloco ```json')
}

function detectarTipo(lista: unknown[]): 'contas' | 'posts' | 'selecao' | null {
  const primeiro = lista.find((x) => x && typeof x === 'object') as Record<string, unknown> | undefined
  if (!primeiro) return null
  if ('posicao' in primeiro || 'posição' in primeiro) return 'selecao'
  if ('classe' in primeiro) return 'contas'
  if ('relevancia' in primeiro || 'relevância' in primeiro) return 'posts'
  return null
}

/** Grava a resposta da LLM. Reimportar o mesmo item substitui a avaliacao anterior. */
export async function importarResposta(texto: string, modelo = 'manual'): Promise<ImportResult> {
  const json = extrairJson(texto)
  if (json && typeof json === 'object' && !Array.isArray(json) && Array.isArray((json as Record<string, unknown>)['selecao'])) {
    return aplicarSelecao((json as Record<string, unknown>)['selecao'] as unknown[], modelo)
  }
  const lista = extrairLista(texto).map((x) => {
    // "relevância" com acento vira "relevancia"
    if (x && typeof x === 'object' && 'relevância' in x) {
      const o = x as Record<string, unknown>
      return { ...o, relevancia: o['relevância'] }
    }
    return x
  })
  const tipo = detectarTipo(lista)
  if (tipo === 'selecao') return aplicarSelecao(lista, modelo)
  const result: ImportResult = { tipo, gravados: 0, desconhecidos: [], invalidos: [] }
  if (!tipo) {
    result.invalidos.push({ id: '-', erro: 'os itens nao tem "classe" (contas) nem "relevancia" (posts)' })
    return result
  }

  for (const bruto of lista) {
    const id = String((bruto as Record<string, unknown> | null)?.['id'] ?? '?')
    const parsed = (tipo === 'contas' ? authorAnswer : postAnswer).safeParse(bruto)
    if (!parsed.success) {
      result.invalidos.push({ id, erro: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') })
      continue
    }
    const { id: _id, ...output } = parsed.data
    // regra dura dos criterios v2: anuncio vale no maximo media, mesmo que a LLM diga alta
    if (tipo === 'posts') {
      const o = output as Record<string, unknown>
      if (o.formato === 'anuncio' && o.relevancia === 'alta') {
        o.relevancia = 'media'
        o.rebaixado = true
      }
    }

    const alvo =
      tipo === 'contas'
        ? db.all<{ id: string }>(sql`select id from author where lower(username) = ${id.replace(/^@/, '').trim().toLowerCase()} limit 1`)[0]
        : db.all<{ id: string }>(sql`select id from post where shortcode = ${id.trim()} limit 1`)[0]
    if (!alvo) {
      result.desconhecidos.push(id)
      continue
    }

    const values = {
      targetType: tipo === 'contas' ? 'author' : 'post',
      targetId: alvo.id,
      source: 'llm',
      model: modelo.slice(0, 60) || 'manual',
      promptVersion: tipo === 'contas' ? CONTAS_VERSION : POSTS_VERSION,
      output: output as Record<string, unknown>,
      createdAt: new Date(),
    }
    await db
      .insert(classification)
      .values(values)
      .onConflictDoUpdate({
        target: [classification.targetType, classification.targetId, classification.source],
        set: { model: values.model, promptVersion: values.promptVersion, output: values.output, createdAt: values.createdAt },
      })
    result.gravados++
  }
  return result
}

/**
 * Sua correcao. Vale sobre a LLM no painel e vira exemplo nos proximos prompts.
 * `valor` null apaga a correcao e volta a valer o que a LLM disse.
 */
export async function corrigir(alvo: 'conta' | 'post', id: string, valor: string | null): Promise<boolean> {
  const row =
    alvo === 'conta'
      ? db.all<{ id: string }>(sql`select id from author where lower(username) = ${id.replace(/^@/, '').toLowerCase()} limit 1`)[0]
      : db.all<{ id: string }>(sql`select id from post where shortcode = ${id} limit 1`)[0]
  if (!row) return false
  const targetType = alvo === 'conta' ? 'author' : 'post'

  if (valor === null) {
    db.run(sql`delete from classification where target_type = ${targetType} and target_id = ${row.id} and source = 'humano'`)
    return true
  }
  const valido = alvo === 'conta' ? (AUTHOR_CLASSES as readonly string[]).includes(valor) : (RELEVANCES as readonly string[]).includes(valor)
  if (!valido) throw new Error(`valor invalido: ${valor}`)

  const output = alvo === 'conta' ? { classe: valor } : { relevancia: valor }
  await db
    .insert(classification)
    .values({ targetType, targetId: row.id, source: 'humano', model: 'voce', promptVersion: alvo === 'conta' ? CONTAS_VERSION : POSTS_VERSION, output })
    .onConflictDoUpdate({
      target: [classification.targetType, classification.targetId, classification.source],
      set: { output, createdAt: new Date() },
    })
  return true
}

/**
 * Rodada de selecao: as contas escolhidas passam a ser acompanhadas pela IA e
 * as que a IA acompanhava e ficaram de fora saem. Nunca mexe no que voce
 * marcou (acompanhar ou ignorar).
 */
async function aplicarSelecao(lista: unknown[], modelo: string): Promise<ImportResult> {
  const result: ImportResult = { tipo: 'selecao', gravados: 0, removidos: [], desconhecidos: [], invalidos: [] }
  const escolhidas = new Set<string>()

  for (const [i, bruto] of lista.entries()) {
    const id = String((bruto as Record<string, unknown> | null)?.['id'] ?? '?')
    const parsed = selecaoItem.safeParse(bruto)
    if (!parsed.success) {
      result.invalidos.push({ id, erro: parsed.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; ') })
      continue
    }
    const u = parsed.data.id.replace(/^@/, '').trim().toLowerCase()
    const conta = db.all<{ id: string; watch: string | null; watchSource: string | null }>(sql`
      select id, watch, watch_source as watchSource from author where lower(username) = ${u} limit 1
    `)[0]
    if (!conta) {
      result.desconhecidos.push(parsed.data.id)
      continue
    }
    // sua decisao manda: ignorada continua ignorada, e a sua marcacao continua sua
    if (conta.watch === 'ignorar') {
      result.invalidos.push({ id: parsed.data.id, erro: 'voce marcou Ignorar nesta conta; mantida ignorada' })
      continue
    }
    escolhidas.add(conta.id)
    if (!(conta.watch === 'acompanhar' && conta.watchSource !== 'ia')) {
      await db.update(author).set({ watch: 'acompanhar', watchSource: 'ia', watchSetAt: new Date() }).where(eq(author.id, conta.id))
    }
    const output = { posicao: parsed.data.posicao ?? i + 1, motivo: parsed.data.motivo }
    await db
      .insert(classification)
      .values({ targetType: 'author', targetId: conta.id, source: 'selecao', model: modelo.slice(0, 60) || 'manual', promptVersion: SELECAO_VERSION, output })
      .onConflictDoUpdate({
        target: [classification.targetType, classification.targetId, classification.source],
        set: { output, model: modelo.slice(0, 60) || 'manual', createdAt: new Date() },
      })
    result.gravados++
  }

  if (result.gravados === 0) return result

  // quem a IA acompanhava e nao foi escolhido de novo perde a vaga
  const antigas = db.all<{ id: string; username: string }>(sql`
    select id, username from author where watch = 'acompanhar' and watch_source = 'ia'
  `)
  for (const a of antigas) {
    if (escolhidas.has(a.id)) continue
    await db.update(author).set({ watch: null, watchSource: null, watchSetAt: null }).where(eq(author.id, a.id))
    await db
      .delete(classification)
      .where(and(eq(classification.targetType, 'author'), eq(classification.targetId, a.id), eq(classification.source, 'selecao')))
    result.removidos!.push(`@${a.username}`)
  }
  return result
}
