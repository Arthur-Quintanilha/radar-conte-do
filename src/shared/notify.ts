import { config } from './config'
import { logger } from './logger'

/** Notificacao best-effort. Falha de notificacao nunca derruba um run. */
export async function notify(text: string): Promise<void> {
  logger.info({ notify: true }, text)
  const token = config.TELEGRAM_BOT_TOKEN
  const chatId = config.TELEGRAM_CHAT_ID
  if (!token || !chatId) return
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_notification: false }),
    })
  } catch (error) {
    logger.warn({ error }, 'falha ao notificar')
  }
}
