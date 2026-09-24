import { parseMedia, type ParsedMedia } from './media'

type Rec = Record<string, unknown>

function asRec(value: unknown): Rec | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Rec) : null
}

export interface SearchPage {
  /** midias na ordem em que aparecem na grade */
  medias: ParsedMedia[]
  hasNextPage: boolean
}

/**
 * Resultados da busca por palavra (/explore/search/keyword/?q=...).
 *
 * A pagina pede `PolarisKeywordSearchExplorePageRelayQuery` (primeira pagina)
 * e `...PaginationQuery` (ao rolar), ambas em /api/graphql, e a resposta vem
 * em data.xdt_fbsearch__top_serp_graphql.edges[]. Cada edge e uma "unidade":
 * cabecalho, bloco de contas ou uma linha da grade com ate 3 midias.
 * So as linhas da grade viram post; a ordem das edges e a posicao na tela.
 */
export function parseSearchPage(body: unknown, targetWidth = 720): SearchPage | null {
  const serp = asRec(asRec(asRec(body)?.['data'])?.['xdt_fbsearch__top_serp_graphql'])
  if (!serp) return null

  const edges = Array.isArray(serp['edges']) ? serp['edges'] : []
  const medias: ParsedMedia[] = []
  const vistos = new Set<string>()

  for (const edge of edges) {
    const node = asRec(asRec(edge)?.['node'])
    const items = node?.['items']
    if (!Array.isArray(items)) continue
    for (const item of items) {
      // hoje a midia vem direto no item; se um dia vier embrulhada em `media`, tambem serve
      const parsed = parseMedia(asRec(item)?.['media'] ?? item, targetWidth)
      if (parsed && !vistos.has(parsed.shortcode)) {
        vistos.add(parsed.shortcode)
        medias.push(parsed)
      }
    }
  }

  const hasNextPage = asRec(serp['page_info'])?.['has_next_page'] === true
  return { medias, hasNextPage }
}

export function isSearchPageUrl(pageUrl: string | null): boolean {
  if (!pageUrl) return false
  try {
    return new URL(pageUrl).pathname.startsWith('/explore/search/keyword')
  } catch {
    return false
  }
}

/** Termo pesquisado, lido da URL da pagina de resultados. */
export function searchTermOf(pageUrl: string | null): string | null {
  if (!pageUrl) return null
  try {
    const q = new URL(pageUrl).searchParams.get('q')
    return q ? q.trim().toLowerCase() : null
  } catch {
    return null
  }
}
