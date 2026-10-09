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

// tabelas novas que o painel le em toda carga: criadas aqui para nao quebrar
// quem ainda nao rodou npm run db:push (o DDL e o mesmo que o drizzle-kit gera)
try {
  sqlite.exec(`CREATE TABLE IF NOT EXISTS \`roteiro\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`ideia_id\` text NOT NULL,
  \`persona_id\` text NOT NULL,
  \`versao\` integer DEFAULT 1 NOT NULL,
  \`resposta\` text,
  \`pedido\` text,
  \`conteudo\` text NOT NULL,
  \`texto\` text,
  \`status\` text DEFAULT 'rascunho' NOT NULL,
  \`modelo\` text,
  \`created_at\` integer NOT NULL,
  FOREIGN KEY (\`ideia_id\`) REFERENCES \`ideia\`(\`id\`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (\`persona_id\`) REFERENCES \`persona\`(\`id\`) ON UPDATE no action ON DELETE no action
);
CREATE INDEX IF NOT EXISTS \`roteiro_ideia_idx\` ON \`roteiro\` (\`ideia_id\`);
CREATE TABLE IF NOT EXISTS \`pauta_visto\` (
  \`persona_id\` text NOT NULL,
  \`post_id\` text NOT NULL,
  \`territorio_versao\` integer NOT NULL,
  \`visto_em\` integer NOT NULL,
  PRIMARY KEY (\`persona_id\`, \`post_id\`)
);`)
} catch {
  // banco somente leitura ou sem as tabelas base: o db:push resolve
}

export const db = drizzle(sqlite, { schema })

let fechado = false

export function closeDb(): void {
  if (fechado) return
  fechado = true
  sqlite.close()
}
