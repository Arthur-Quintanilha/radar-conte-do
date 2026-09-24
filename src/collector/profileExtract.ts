export interface ProfileFacts {
  username: string
  igUserId?: string
  fullName?: string
  isVerified?: boolean
  followersCount?: number
  /** de onde o numero veio: json embutido, regex no html, ou meta tag (arredondado) */
  source: 'json' | 'regex' | 'meta'
}

type Rec = Record<string, unknown>

const SCRIPT_RE = /<script[^>]*>([\s\S]*?)<\/script>/gi
const MAX_NODES = 300_000

function asRec(value: unknown): Rec | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Rec) : undefined
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value)
  return undefined
}

/**
 * Le contagens escritas para humanos: "1,234", "1.234", "128 mil",
 * "128K", "1,2 mi", "1.2M". Sem sufixo, virgula e ponto sao separador
 * de milhar; com sufixo, sao decimal.
 */
export function parseCountText(raw: string | null | undefined): number | undefined {
  if (!raw) return undefined
  const match = raw.match(/(\d[\d.,\s]*)\s*(mil|mi|bi|k|m|b)?\b/i)
  if (!match) return undefined

  const digits = (match[1] ?? '').replace(/\s/g, '').replace(/[.,]$/, '')
  const suffix = (match[2] ?? '').toLowerCase()

  const multiplier =
    suffix === 'mil' || suffix === 'k' ? 1_000 : suffix === 'mi' || suffix === 'm' ? 1_000_000 : suffix === 'bi' || suffix === 'b' ? 1_000_000_000 : 1

  const value =
    multiplier === 1 ? Number(digits.replace(/[.,]/g, '')) : Number(digits.replace(',', '.')) * multiplier

  return Number.isFinite(value) ? Math.round(value) : undefined
}

function followersOf(node: Rec): number | undefined {
  return asNumber(node['follower_count']) ?? asNumber(asRec(node['edge_followed_by'])?.['count'])
}

/** Procura, dentro de um JSON qualquer, o objeto de usuario com esse username. */
function findUser(root: unknown, username: string): Rec | undefined {
  const target = username.toLowerCase()
  const stack: unknown[] = [root]
  let visited = 0

  while (stack.length > 0 && visited < MAX_NODES) {
    const current = stack.pop()
    visited++
    if (current === null || typeof current !== 'object') continue

    if (!Array.isArray(current)) {
      const node = current as Rec
      const name = node['username']
      if (typeof name === 'string' && name.toLowerCase() === target && followersOf(node) !== undefined) {
        return node
      }
    }

    const children: unknown[] = Array.isArray(current) ? current : Object.values(current as Rec)
    for (const child of children) {
      if (child !== null && typeof child === 'object') stack.push(child)
    }
  }
  return undefined
}

/**
 * A pagina de perfil e renderizada no servidor, entao nao ha XHR para
 * interceptar. Os dados vem em blobs JSON dentro de <script>. Tres camadas,
 * da mais precisa para a mais tosca.
 */
export function extractProfileFromHtml(html: string, username: string): ProfileFacts | null {
  // 1. blobs JSON embutidos
  for (const match of html.matchAll(SCRIPT_RE)) {
    const content = match[1]?.trim()
    if (!content || content.length < 40) continue
    const start = content.indexOf('{')
    if (start === -1) continue

    let parsed: unknown
    try {
      parsed = JSON.parse(content.slice(start))
    } catch {
      continue
    }

    const user = findUser(parsed, username)
    if (user) {
      return {
        username,
        igUserId: typeof user['id'] === 'string' ? user['id'] : asNumber(user['pk'])?.toString(),
        fullName: typeof user['full_name'] === 'string' ? user['full_name'] : undefined,
        isVerified: typeof user['is_verified'] === 'boolean' ? user['is_verified'] : undefined,
        followersCount: followersOf(user),
        source: 'json',
      }
    }
  }

  // 2. regex direto no html, para quando o blob nao for JSON valido isolado
  const direct =
    html.match(/"edge_followed_by"\s*:\s*\{\s*"count"\s*:\s*(\d+)/) ?? html.match(/"follower_count"\s*:\s*(\d+)/)
  const fromRegex = direct?.[1] ? Number(direct[1]) : undefined
  if (fromRegex !== undefined && Number.isFinite(fromRegex)) {
    return { username, followersCount: fromRegex, source: 'regex' }
  }

  // 3. meta description: numero arredondado, ultimo recurso
  const meta = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)
  const fromMeta = parseCountText(meta?.[1])
  if (fromMeta !== undefined) {
    return { username, followersCount: fromMeta, source: 'meta' }
  }

  return null
}
