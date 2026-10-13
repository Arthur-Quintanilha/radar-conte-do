import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { sql } from 'drizzle-orm'
import { all, comoJson } from '../db/client'

interface Row {
  shortcode: string
  username: string | null
  mediaType: string | null
  caption: string | null
  duration: number | null
  model: string
  output: string
}

interface Entry {
  shortcode: string
  username: string | null
  mediaType: string | null
  caption: string | null
  duration: number | null
  transcripts: { model: string; text: string }[]
}

async function load(filtro?: string): Promise<Entry[]> {
  const rows = await all<Row>(sql`
    select p.shortcode as shortcode, a.username as username, p.media_type as "mediaType",
           p.caption as caption,
           (select m.duration_s from media_asset m
             where m.post_id = p.id and m.kind = 'video' order by m.position limit 1) as duration,
           e.model as model, e.output as output
    from enrichment e
    join post p on p.id = e.post_id
    left join author a on a.id = p.author_id
    where e.kind = 'transcript'
      and (${filtro ?? null} is null or p.shortcode = ${filtro ?? null})
    order by p.first_seen_at desc, p.shortcode, e.model
  `)

  const porPost = new Map<string, Entry>()
  for (const r of rows) {
    const entry = porPost.get(r.shortcode) ?? {
      shortcode: r.shortcode,
      username: r.username,
      mediaType: r.mediaType,
      caption: r.caption,
      duration: r.duration,
      transcripts: [],
    }
    let text = ''
    try {
      text = comoJson<{ text?: string }>(r.output, {}).text ?? ''
    } catch {
      text = r.output
    }
    entry.transcripts.push({ model: r.model, text })
    porPost.set(r.shortcode, entry)
  }
  return [...porPost.values()]
}

function wrap(text: string, width: number, indent: string): string {
  const palavras = text.split(/\s+/).filter(Boolean)
  const linhas: string[] = []
  let atual = ''
  for (const p of palavras) {
    if ((atual + ' ' + p).trim().length > width) {
      linhas.push(atual)
      atual = p
    } else {
      atual = (atual + ' ' + p).trim()
    }
  }
  if (atual) linhas.push(atual)
  return linhas.map((l) => indent + l).join('\n')
}

function meta(e: Entry): string {
  const dur = e.duration ? `${Math.round(e.duration)}s` : '?'
  return `@${e.username ?? '?'} · ${e.mediaType ?? '?'} · ${dur}`
}

function primeiraLinha(caption: string | null): string {
  return (caption ?? '').split('\n').find((l) => l.trim() !== '')?.trim() ?? '(sem legenda)'
}

export async function printTranscripts(filtro?: string): Promise<void> {
  const entries = await load(filtro)
  if (entries.length === 0) {
    console.log('\nNenhuma transcricao ainda. Rode: npm run media && npm run whisper\n')
    return
  }

  for (const e of entries) {
    console.log(`\n━━━ ${e.shortcode}   ${meta(e)}`)
    console.log(`    legenda: ${primeiraLinha(e.caption).slice(0, 90)}`)
    for (const t of e.transcripts) {
      console.log(`\n    [${t.model}]`)
      console.log(t.text ? wrap(t.text, 92, '    ') : '    (sem fala)')
    }
  }
  console.log(`\n${entries.length} posts com transcricao\n`)
}

/** Markdown para ler no editor — terminal nao e lugar pra ler 30 textos longos. */
export async function exportTranscripts(arquivo: string, filtro?: string): Promise<string> {
  const entries = await load(filtro)
  const partes: string[] = [`# Transcricoes — ${entries.length} posts`, '']

  for (const e of entries) {
    partes.push(`## ${e.shortcode} — @${e.username ?? '?'}`, '')
    partes.push(`${meta(e)} · https://www.instagram.com/p/${e.shortcode}/`, '')
    partes.push(`**Legenda:** ${primeiraLinha(e.caption)}`, '')
    for (const t of e.transcripts) {
      partes.push(`**${t.model}:** ${t.text || '_(sem fala)_'}`, '')
    }
    partes.push('---', '')
  }

  const caminho = resolve(process.cwd(), arquivo)
  await writeFile(caminho, partes.join('\n'), 'utf8')
  return caminho
}
