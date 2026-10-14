/**
 * Entrada da API na nuvem (npm run build && npm start). Só importa o
 * servidor: nada de Chrome, Whisper ou pastas de mídia.
 */
import { config } from '../comum/config'
import { logger } from '../comum/logger'
import { closeDb, migrar } from '../servidor/db/client'
import { montarSoApi } from '../servidor/montarApi'
import { startApi } from '../servidor/painel/server'

montarSoApi()
try {
  await migrar()
  logger.info('banco em dia')
} catch (error) {
  logger.error({ erro: error instanceof Error ? error.message : String(error) }, 'migrations falharam')
  process.exit(1)
}
const origens = config.API_ORIGENS.split(',')
  .map((x) => x.trim())
  .filter(Boolean)
await startApi(Number(process.env['PORT']) || 8080, '0.0.0.0', origens)
await closeDb()
