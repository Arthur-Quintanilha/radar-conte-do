// Leitura das respostas da IA: o bloco ```json do meio do texto, com plano B
// para quando a resposta vem quebrada ou cortada.

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

/** Estimativa grosseira de tokens (4 caracteres por token), so para mostrar no painel. */
export const estimarTokens = (texto: string): number => Math.round(texto.length / 4)
