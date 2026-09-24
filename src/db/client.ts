import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { config } from '../shared/config'
import * as schema from './schema'

const file = resolve(process.cwd(), config.DB_FILE)
mkdirSync(dirname(file), { recursive: true })

const sqlite = new Database(file)
sqlite.pragma('journal_mode = WAL')
sqlite.pragma('foreign_keys = ON')
sqlite.pragma('busy_timeout = 5000')

export const db = drizzle(sqlite, { schema })

export function closeDb(): void {
  sqlite.close()
}
