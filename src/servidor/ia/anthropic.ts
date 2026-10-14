import Anthropic from '@anthropic-ai/sdk'
import { config } from '../../comum/config'

let client: Anthropic | null = null

export function anthropic(): Anthropic {
  if (!config.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY nao configurada no .env')
  }
  client ??= new Anthropic({ apiKey: config.ANTHROPIC_API_KEY })
  return client
}

/** Os ids de modelo mudam. Este comando evita ficar adivinhando. */
export async function listModels(): Promise<{ id: string; displayName: string }[]> {
  const page = await anthropic().models.list({ limit: 50 })
  return page.data.map((m) => ({ id: m.id, displayName: m.display_name }))
}
