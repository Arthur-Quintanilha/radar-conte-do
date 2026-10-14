/** O que o coletor captura do Instagram: o tipo de endpoint e a resposta crua. */

export type EndpointKind =
  | 'explore_grid'
  | 'graphql'
  | 'media_info'
  | 'comments'
  | 'profile'
  | 'feed'
  | 'search'
  /** lista de "seguindo" / "seguidores" aberta no perfil (friendships) */
  | 'following'
  /** qualquer outro JSON do Instagram; so gravado no modo captureAll */
  | 'other'
  /** blocos JSON embutidos no HTML da pagina (perfil e renderizado no servidor) */
  | 'html'

export interface Captured {
  url: string
  /** pagina aberta no momento da captura, para saber a procedencia do dado */
  pageUrl: string
  kind: EndpointKind
  status: number
  body: unknown
  capturedAt: Date
}

/** So nos interessam as respostas que o proprio app do Instagram ja pede. */
export function classify(url: string): EndpointKind | null {
  if (!url.includes('instagram.com')) return null
  if (url.includes('/api/v1/discover/web/explore_grid')) return 'explore_grid'
  if (url.includes('/graphql/query')) return 'graphql'
  // resultados da busca (PolarisKeywordSearchExplorePageRelayQuery) vem por aqui
  if (url.includes('/api/graphql')) return 'graphql'
  if (/\/api\/v1\/media\/\d+\/info/.test(url)) return 'media_info'
  if (/\/api\/v1\/media\/\d+\/comments/.test(url)) return 'comments'
  if (url.includes('/api/v1/users/web_profile_info')) return 'profile'
  if (/\/api\/v1\/friendships\/\d+\/following/.test(url)) return 'following'
  if (url.includes('/api/v1/feed/')) return 'feed'
  if (/\/fbsearch\/|\/web\/search\/|topsearch|\/api\/v1\/tags\//.test(url)) return 'search'
  return null
}

