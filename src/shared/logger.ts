import pino from 'pino'
import { config } from './config'

const pretty = process.env.NODE_ENV !== 'production'

export const logger = pino({
  level: config.LOG_LEVEL,
  ...(pretty
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' },
        },
      }
    : {}),
})

export type Logger = typeof logger
