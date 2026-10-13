import { and, eq, inArray, sql } from 'drizzle-orm'
import { all, db } from '../db/client'
import { author, personaConta } from '../db/schema'
import { PENDENTE } from '../collector/watchList'
import { config } from '../shared/config'
import { exigirPersona, sementesComLista } from './persona'

/** Minimo de sementes em comum para uma conta entrar no grafo. */
export function minimoSementes(total: number, configurado = config.GRAFO_MIN_SEMENTES): number {
  if (configurado > 0) return Math.min(configurado, Math.max(1, total))
  if (total <= 1) return 1
  return Math.max(2, Math.ceil(total * 0.3))
}

export interface GrafoSummary {
  sementes: number
  minimo: number
  /** contas seguidas por pelo menos `minimo` sementes */
  contas: number
  /** marcadas para o acompanhar visitar */
  acompanhadas: number
  /** sairam do acompanhamento (a IA ou voce disse que nao sao consumidas) */
  liberadas: number
  reason?: string
}

interface Linha {
  username: string
  n: number
  verificado: boolean | null
}

/** Papel que vale para a conta: sua correcao, depois a IA, depois "candidata". */
export async function papeisEfetivos(personaId: string): Promise<Map<string, { papel: string; source: string }>> {
  const rows = await all<{ username: string; papel: string; source: string }>(sql`
    select username, papel, source from persona_conta where persona_id = ${personaId}
  `)
  const rank: Record<string, number> = { humano: 3, llm: 2, grafo: 1 }
  const m = new Map<string, { papel: string; source: string }>()
  for (const r of rows) {
    const atual = m.get(r.username)
    if (!atual || (rank[r.source] ?? 0) > (rank[atual.source] ?? 0)) m.set(r.username, { papel: r.papel, source: r.source })
  }
  return m
}

/**
 * Recalcula o grafo da persona: quem as sementes seguem em comum. As contas
 * mais citadas (ate GRAFO_MAX_CONTAS) viram "acompanhar", para o
 * `npm run acompanhar` trazer bio e posts. Marcacao sua nunca e alterada.
 */
export async function atualizarGrafo(personaId?: string): Promise<GrafoSummary> {
  const p = await exigirPersona(personaId)
  const sementes = await sementesComLista(p.id)
  const minimo = minimoSementes(sementes.length)
  const vazio: GrafoSummary = { sementes: sementes.length, minimo, contas: 0, acompanhadas: 0, liberadas: 0 }
  if (sementes.length === 0) return { ...vazio, reason: 'nenhuma semente com lista de seguindo coletada: rode npm run seguindo' }

  const excluir = [...sementes, ...(p.handle ? [p.handle] : [])]
  const linhas = await all<Linha>(sql`
    select username, count(distinct semente) as n, bool_or(coalesce(is_verified, false)) as verificado
    from seguindo
    where semente in (${sql.join(sementes.map((s) => sql`${s}`), sql`, `)})
      and username not in (${sql.join(excluir.map((s) => sql`${s}`), sql`, `)})
      and coalesce(is_private, false) = false
    group by username
    having count(distinct semente) >= ${minimo}
    order by n desc, verificado desc, username
  `)

  // contagem do grafo: substitui a anterior inteira
  await db.transaction(async (tx) => {
    await tx.delete(personaConta).where(and(eq(personaConta.personaId, p.id), eq(personaConta.source, 'grafo')))
    if (linhas.length) await tx.insert(personaConta).values(linhas.map((l) => ({ personaId: p.id, username: l.username, papel: 'candidata', source: 'grafo', sementes: l.n })))
  })

  const papeis = await papeisEfetivos(p.id)
  const escolhidas = linhas
    .filter((l) => {
      const e = papeis.get(l.username)?.papel ?? 'candidata'
      return e === 'candidata' || e === 'consumido'
    })
    .slice(0, config.GRAFO_MAX_CONTAS)
    .map((l) => l.username)

  let acompanhadas = 0
  for (const u of escolhidas) {
    const [a] = await db.select({ id: author.id, watch: author.watch, watchSource: author.watchSource }).from(author).where(sql`lower(${author.username}) = ${u}`).limit(1)
    if (!a) {
      await db
        .insert(author)
        .values({ igUserId: PENDENTE + u, username: u, watch: 'acompanhar', watchSource: 'grafo', watchSetAt: new Date() })
        .onConflictDoNothing()
      acompanhadas++
      continue
    }
    // o que voce marcou (acompanhar ou ignorar) fica como esta
    if (a.watchSource === 'voce') {
      if (a.watch === 'acompanhar') acompanhadas++
      continue
    }
    if (a.watch !== 'acompanhar') await db.update(author).set({ watch: 'acompanhar', watchSource: 'grafo', watchSetAt: new Date() }).where(eq(author.id, a.id))
    acompanhadas++
  }

  // quem o grafo marcou antes e agora nao esta mais na lista
  const antigas = await db.select({ id: author.id, username: author.username }).from(author).where(and(eq(author.watchSource, 'grafo'), eq(author.watch, 'acompanhar')))
  const manter = new Set(escolhidas)
  const soltar = antigas.filter((a) => !manter.has(a.username.toLowerCase())).map((a) => a.id)
  if (soltar.length) await db.update(author).set({ watch: null, watchSource: null, watchSetAt: null }).where(inArray(author.id, soltar))

  return { sementes: sementes.length, minimo, contas: linhas.length, acompanhadas, liberadas: soltar.length }
}

/**
 * Contas que o ciclo da persona pode visitar: as do grafo dela que ainda
 * valem (candidata ou consumido, ate GRAFO_MAX_CONTAS) e as referencias ativas.
 */
export async function contasDaPersona(personaId: string, referencias: string[]): Promise<string[]> {
  const papeis = await papeisEfetivos(personaId)
  const grafo = (await all<{ u: string }>(sql`select username as u from persona_conta where persona_id = ${personaId} and source = 'grafo' order by sementes desc`))
    .map((r) => r.u)
    .filter((u) => {
      const e = papeis.get(u)?.papel ?? 'candidata'
      return e === 'candidata' || e === 'consumido'
    })
    .slice(0, config.GRAFO_MAX_CONTAS)
  return [...new Set([...grafo, ...referencias.map((r) => r.toLowerCase())])]
}

export interface ContaGrafo {
  username: string
  sementes: number
  papel: string
  source: string
  confianca: number | null
  motivo: string | null
  tema: string | null
  candidataSemente: boolean
  fullName: string | null
  bio: string | null
  category: string | null
  followers: number | null
  watch: string | null
  lastWatchedAt: number | null
  posts: number
}

/** O grafo da persona, do jeito que o painel mostra. */
export async function contasDoGrafo(personaId: string): Promise<ContaGrafo[]> {
  const rows = await all<{
    username: string
    sementes: number
    fullName: string | null
    bio: string | null
    category: string | null
    followers: number | null
    watch: string | null
    lastWatchedAt: number | null
    posts: number
  }>(sql`
    select g.username, g.sementes,
      coalesce(a.full_name, (select max(s.full_name) from seguindo s where s.username = g.username)) as "fullName",
      a.biography as bio, a.category, a.followers_count as followers, a.watch, a.last_watched_at as "lastWatchedAt",
      (select count(*) from post p where p.author_id = a.id) as posts
    from persona_conta g
    left join author a on lower(a.username) = g.username
    where g.persona_id = ${personaId} and g.source = 'grafo'
    order by g.sementes desc, g.username
  `)
  const det = await all<{ username: string; source: string; papel: string; confianca: number | null; motivo: string | null; tema: string | null; cs: boolean | null }>(sql`
    select username, source, papel, confianca, motivo, tema, candidata_semente as cs from persona_conta
    where persona_id = ${personaId} and source in ('llm', 'humano')
  `)
  const llm = new Map(det.filter((d) => d.source === 'llm').map((d) => [d.username, d]))
  const hum = new Map(det.filter((d) => d.source === 'humano').map((d) => [d.username, d]))
  return rows.map((r) => {
    const l = llm.get(r.username)
    const h = hum.get(r.username)
    return {
      ...r,
      papel: h?.papel ?? l?.papel ?? 'candidata',
      source: h ? 'humano' : l ? 'llm' : 'grafo',
      confianca: l?.confianca ?? null,
      motivo: l?.motivo ?? null,
      tema: l?.tema ?? null,
      candidataSemente: l?.cs === true,
    }
  })
}

/** Sua correcao do papel de uma conta. null apaga a correcao. */
export async function corrigirPapel(personaId: string, username: string, papel: string | null): Promise<void> {
  const u = username.replace(/^@/, '').toLowerCase()
  await db.delete(personaConta).where(and(eq(personaConta.personaId, personaId), eq(personaConta.username, u), eq(personaConta.source, 'humano')))
  if (papel) await db.insert(personaConta).values({ personaId, username: u, papel, source: 'humano' })
}
