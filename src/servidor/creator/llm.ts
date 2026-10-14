import { anthropic } from '../ia/anthropic'
import { config } from '../../comum/config'
import { logger } from '../../comum/logger'
import { sleep } from '../../comum/human'

export const temApi = (): boolean => Boolean(config.ANTHROPIC_API_KEY)
export const modeloCreator = (): string => config.CREATOR_MODEL || config.ANTHROPIC_MODEL
export const modeloPauta = (): string => config.PAUTA_MODEL || modeloCreator()

const SYSTEM =
  'Você é o estrategista de conteúdo de um creator no Instagram. Responda sempre em português do Brasil e SOMENTE com o bloco ```json pedido, sem texto antes ou depois.'

/**
 * Uma chamada, com o prompt inteiro numa mensagem so. O mesmo prompt serve
 * para colar numa conversa (fluxo manual do painel) quando nao ha chave.
 */
export async function perguntarLlm(
  prompt: string,
  opts: { modelo?: string; maxTokens?: number; imagens?: { mime: 'image/jpeg' | 'image/png' | 'image/webp'; base64: string; rotulo: string }[] } = {},
): Promise<{ texto: string; modelo: string }> {
  const modelo = opts.modelo ?? modeloCreator()
  for (let tentativa = 1; ; tentativa++) {
    try {
      const r = await anthropic().messages.create({
        model: modelo,
        max_tokens: opts.maxTokens ?? 8_000,
        system: SYSTEM,
        messages: [
          {
            role: 'user',
            content: opts.imagens?.length
              ? [
                  ...opts.imagens.flatMap((im) => [
                    { type: 'text' as const, text: `[${im.rotulo}]` },
                    { type: 'image' as const, source: { type: 'base64' as const, media_type: im.mime, data: im.base64 } },
                  ]),
                  { type: 'text' as const, text: prompt },
                ]
              : prompt,
          },
        ],
      })
      const texto = r.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
      if (r.stop_reason === 'max_tokens') logger.warn({ modelo }, 'resposta cortada no limite de tokens; diminua o lote')
      return { texto, modelo }
    } catch (error) {
      const status = (error as { status?: number }).status
      if (tentativa < 4 && (status === 429 || status === 529 || (status !== undefined && status >= 500))) {
        logger.warn({ status, tentativa }, 'API ocupada, tentando de novo')
        await sleep(5_000 * tentativa)
        continue
      }
      if (status === 404) throw new Error(`modelo "${modelo}" nao existe na sua conta: rode npm run models e ajuste CREATOR_MODEL/ANTHROPIC_MODEL`)
      throw error
    }
  }
}
