import { sql } from 'drizzle-orm'
import { all } from '../db/client'
import { config } from '../../comum/config'

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
  console.log(`\nBanco: ${(config.DATABASE_URL ?? '').replace(/:[^:@/]+@/, ':***@') || '(DATABASE_URL vazia)'}\n`)

  const tables = await all<TableInfo>(sql`
    select table_name as name from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE' and table_name not like '__drizzle%'
    order by table_name
  `)

  for (const table of tables) {
    const columns = await all<ColumnInfo>(sql`
      select c.column_name as name, c.data_type as type,
        (exists (select 1 from information_schema.key_column_usage k join information_schema.table_constraints t
           on t.constraint_name = k.constraint_name and t.constraint_type = 'PRIMARY KEY'
           where k.table_name = c.table_name and k.column_name = c.column_name))::int as pk,
        (c.is_nullable = 'NO')::int as notnull
      from information_schema.columns c where c.table_schema = 'public' and c.table_name = ${table.name}
      order by c.ordinal_position
    `)
    const [count] = await all<{ n: number }>(sql.raw(`select count(*)::int as n from "${table.name}"`))

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
  const rows = await all<Record<string, unknown>>(sql.raw(query))
  console.log()
  printRows(rows)
  console.log()
}
