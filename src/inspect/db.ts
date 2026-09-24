import { sql } from 'drizzle-orm'
import { db } from '../db/client'
import { config } from '../shared/config'

interface TableInfo {
  name: string
}
interface ColumnInfo {
  name: string
  type: string
  pk: number
  notnull: number
}

function truncate(value: unknown, max: number): string {
  if (value === null || value === undefined) return '—'
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value)
  const clean = text.replace(/\s+/g, ' ')
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}

/** Imprime linhas como tabela de largura fixa, truncando o que for longo. */
export function printRows(rows: Record<string, unknown>[], maxWidth = 38): void {
  if (rows.length === 0) {
    console.log('  (nenhuma linha)')
    return
  }

  const columns = Object.keys(rows[0] ?? {})
  const widths = columns.map((col) =>
    Math.min(maxWidth, Math.max(col.length, ...rows.map((r) => truncate(r[col], maxWidth).length))),
  )

  const line = (cells: string[]) =>
    cells.map((cell, i) => cell.padEnd(widths[i] ?? cell.length)).join('  ')

  console.log('  ' + line(columns))
  console.log('  ' + widths.map((w) => '─'.repeat(w)).join('  '))
  for (const row of rows) {
    console.log('  ' + line(columns.map((col, i) => truncate(row[col], widths[i] ?? maxWidth))))
  }
  console.log(`  (${rows.length} linha${rows.length === 1 ? '' : 's'})`)
}

export async function describeDb(): Promise<void> {
  console.log(`\nBanco: ${config.DB_FILE}\n`)

  const tables = await db.all<TableInfo>(sql`
    select name from sqlite_master
    where type = 'table' and name not like 'sqlite_%' and name not like '__drizzle%'
    order by name
  `)

  for (const table of tables) {
    const columns = await db.all<ColumnInfo>(sql.raw(`pragma table_info(${table.name})`))
    const [count] = await db.all<{ n: number }>(sql.raw(`select count(*) as n from ${table.name}`))

    console.log(`${table.name}  —  ${count?.n ?? 0} linhas`)
    for (const column of columns) {
      const marks = [column.pk ? 'PK' : null, column.notnull ? 'obrigatorio' : null]
        .filter(Boolean)
        .join(', ')
      console.log(`   ${column.name.padEnd(22)} ${column.type.padEnd(8)} ${marks}`)
    }
    console.log()
  }
}

export async function runSql(query: string): Promise<void> {
  const rows = await db.all<Record<string, unknown>>(sql.raw(query))
  console.log()
  printRows(rows)
  console.log()
}
