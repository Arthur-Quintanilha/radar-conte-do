export interface DiscoveredItem {
  shortcode: string
  mediaId?: string
  mediaType?: string
}

const SHORTCODE_RE = /^[A-Za-z0-9_-]{8,20}$/
const MAX_NODES = 200_000

function mapMediaType(node: Record<string, unknown>): string | undefined {
  const productType = node['product_type']
  if (productType === 'clips') return 'reel'

  const raw = node['media_type'] ?? node['__typename']
  if (raw === 1 || raw === 'GraphImage' || raw === 'XDTGraphImage') return 'image'
  if (raw === 2 || raw === 'GraphVideo' || raw === 'XDTGraphVideo') return 'video'
  if (raw === 8 || raw === 'GraphSidecar' || raw === 'XDTGraphSidecar') return 'carousel'
  return undefined
}

function readMediaId(node: Record<string, unknown>): string | undefined {
  const raw = node['pk'] ?? node['id'] ?? node['pk_id']
  if (typeof raw === 'string' || typeof raw === 'number') return String(raw)
  return undefined
}

/**
 * Busca em profundidade tolerante a schema. Em vez de navegar caminhos fixos
 * (que quebram a cada mudanca do Instagram), procura qualquer objeto que
 * pareca uma midia: tem `code` com cara de shortcode e um id junto.
 *
 * Os filhos entram na pilha em ordem invertida de proposito: assim o pop
 * devolve a ordem original do documento, e a posicao no grid do Explorar
 * (que e sinal de relevancia) se preserva.
 */
export function extractItems(body: unknown): DiscoveredItem[] {
  const found = new Map<string, DiscoveredItem>()
  const stack: unknown[] = [body]
  let visited = 0

  while (stack.length > 0 && visited < MAX_NODES) {
    const current = stack.pop()
    visited++

    if (current === null || typeof current !== 'object') continue

    let matched = false
    if (!Array.isArray(current)) {
      const node = current as Record<string, unknown>
      const code = node['code'] ?? node['shortcode']
      if (typeof code === 'string' && SHORTCODE_RE.test(code)) {
        matched = true
        if (!found.has(code)) {
          found.set(code, {
            shortcode: code,
            mediaId: readMediaId(node),
            mediaType: mapMediaType(node),
          })
        }
      }
    }

    // slides de carrossel tem code proprio mas nao sao posts — ver media.ts
    const children: unknown[] = Array.isArray(current)
      ? current
      : Object.entries(current as Record<string, unknown>)
          .filter(([key]) => !(matched && key === 'carousel_media'))
          .map(([, value]) => value)

    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i]
      if (child !== null && typeof child === 'object') stack.push(child)
    }
  }

  return [...found.values()]
}
