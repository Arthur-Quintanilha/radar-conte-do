import { config } from './config'

/** Hora local (0-23) no fuso configurado. */
export function localHour(date = new Date()): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: config.TZ_NAME,
    hour: 'numeric',
    hour12: false,
  })
  return Number(fmt.format(date))
}

/** Chave de dia YYYY-MM-DD no fuso configurado. Usada para contar sessoes por dia. */
export function localDayKey(date = new Date()): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: config.TZ_NAME,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  return fmt.format(date)
}
