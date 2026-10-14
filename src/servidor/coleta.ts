import { and, asc, desc, eq, gte, inArray, isNull, like, lt, or, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { db } from './db/client'
import { author, collectionRun, enrichment, mediaAsset, persona, post, rawResponse, semente } from './db/schema'
import { checkBudget } from './budget'
import { parsePending } from './parser/run'
import { config } from '../comum/config'
import { localDayKey } from '../comum/time'
import type { CapturaEnviada, ContaFila, DadosSemente, FilaWhisper, MidiaDoPost, MidiaRemota, ResumoColeta, ResumoParse, TipoColeta } from '../comum/porta'
import type { ProfileFacts } from '../comum/parser/profileExtract'

/**
 * O lado servidor da coleta: o que o worker pede e manda (filas, capturas,
 * perfis, sementes, mídias e transcrições). Só aqui a coleta toca o banco.
 */

const MAX_TENTATIVAS = 3
/** a URL do CDN do Instagram vale poucas horas: só vale a pena tentar mídia de post visto há pouco */
const MIDIA_FRESCA_DIAS = 3

// ---------------------------------------------------------------- coleta

export async function orcamento(tipo: TipoColeta): Promise<{ allowed: boolean; reason: string }> {
  // a visita a perfis nao tem teto proprio: o ciclo controla
  if (tipo === 'watch') return { allowed: true, reason: 'sem teto' }
  const b = await checkBudget(tipo)
  return { allowed: b.allowed, reason: b.reason }
}

export async function abrirColeta(tipo: TipoColeta): Promise<string> {
  const [r] = await db.insert(collectionRun).values({ kind: tipo, dayKey: localDayKey() }).returning({ id: collectionRun.id })
  if (!r) throw new Error('nao foi possivel criar o collection_run')
  return r.id
}

export async function salvarCaptura(runId: string, c: CapturaEnviada): Promise<void> {
  await db.insert(rawResponse).values({
    runId,
    url: c.url,
    pageUrl: c.pageUrl,
    endpointKind: c.kind,
    status: c.status,
    body: c.body,
    bodyHash: c.bodyHash,
    capturedAt: new Date(c.capturedAt),
  })
}

export async function fecharColeta(runId: string, r: ResumoColeta): Promise<void> {
  await db
    .update(collectionRun)
    .set({
      endedAt: new Date(),
      status: r.status,
      ...(r.cardsSeen !== undefined ? { cardsSeen: r.cardsSeen } : {}),
      ...(r.postsOpened !== undefined ? { postsOpened: r.postsOpened } : {}),
      ...(r.responsesCaptured !== undefined ? { responsesCaptured: r.responsesCaptured } : {}),
      abortReason: r.abortReason ?? null,
    })
    .where(eq(collectionRun.id, runId))
}

export async function processarCapturas(): Promise<ResumoParse> {
  return parsePending(5_000)
}

/** Quem esta marcado como "acompanhar", do que foi visitado ha mais tempo para o mais recente. */
export async function filaAcompanhar(limite: number, permitidos?: string[]): Promise<ContaFila[]> {
  if (permitidos && permitidos.length === 0) return []
  const antesDe = new Date(Date.now() - config.WATCH_MIN_HOURS * 3_600_000)
  return db
    .select({ id: author.id, username: author.username })
    .from(author)
    .where(
      and(
        eq(author.watch, 'acompanhar'),
        or(isNull(author.lastWatchedAt), lt(author.lastWatchedAt, antesDe)),
        permitidos ? inArray(sql`lower(${author.username})`, permitidos) : undefined,
      ),
    )
    .orderBy(sql`${author.lastWatchedAt} is not null`, asc(author.lastWatchedAt))
    .limit(limite)
}

export async function contaPorUsername(username: string): Promise<ContaFila | null> {
  const u = username.replace(/^@/, '').trim().toLowerCase()
  const [r] = await db.select({ id: author.id, username: author.username }).from(author).where(sql`lower(${author.username}) = ${u}`).limit(1)
  return r ?? null
}

export async function marcarVisitada(authorId: string): Promise<void> {
  await db.update(author).set({ lastWatchedAt: new Date() }).where(eq(author.id, authorId))
}

export async function aplicarPerfil(authorId: string, facts: ProfileFacts): Promise<void> {
  await db
    .update(author)
    .set({
      lastSeenAt: new Date(),
      ...(facts.followersCount !== undefined ? { followersCount: facts.followersCount } : {}),
      ...(facts.fullName !== undefined ? { fullName: facts.fullName } : {}),
      ...(facts.isVerified !== undefined ? { isVerified: facts.isVerified } : {}),
      ...(facts.biography !== undefined ? { biography: facts.biography } : {}),
      ...(facts.category !== undefined ? { category: facts.category } : {}),
    })
    .where(eq(author.id, authorId))
}

/**
 * Sementes confirmadas da persona ativa cuja lista nao foi coletada nos
 * ultimos SEGUINDO_MIN_DIAS dias. Nunca coletadas primeiro.
 */
export async function filaSeguindo(limite: number): Promise<string[]> {
  const antesDe = new Date(Date.now() - config.SEGUINDO_MIN_DIAS * 86_400_000)
  const doPainel = process.env['PERSONA_ID']
  const rows = await db
    .select({ username: semente.username })
    .from(semente)
    .innerJoin(persona, eq(persona.id, semente.personaId))
    .where(
      and(
        doPainel ? eq(persona.id, doPainel) : eq(persona.ativa, true),
        eq(semente.status, 'confirmada'),
        or(isNull(semente.coletadaEm), lt(semente.coletadaEm, antesDe)),
        // privada sem acesso nao adianta tentar toda semana
        sql`coalesce(${semente.privada}, false) = false`,
      ),
    )
    .orderBy(sql`${semente.coletadaEm} is not null`, asc(semente.coletadaEm))
    .limit(limite)
  return rows.map((r) => r.username)
}

export async function marcarSemente(username: string, d: DadosSemente): Promise<void> {
  const set: Partial<typeof semente.$inferInsert> = {
    ...(d.fullName !== undefined ? { fullName: d.fullName } : {}),
    ...(d.biography !== undefined ? { biography: d.biography } : {}),
    ...(d.followingCount !== undefined ? { followingCount: d.followingCount } : {}),
    ...(d.privada !== undefined ? { privada: d.privada } : {}),
    ...(d.erro !== undefined ? { erro: d.erro } : {}),
    ...(d.tentativaEm !== undefined ? { tentativaEm: new Date(d.tentativaEm) } : {}),
    ...(d.coletadaEm !== undefined ? { coletadaEm: new Date(d.coletadaEm) } : {}),
  }
  // o drizzle recusa UPDATE sem campos
  if (Object.keys(set).length === 0) return
  await db.update(semente).set(set).where(sql`lower(${semente.username}) = ${username.toLowerCase()}`)
}

// ---------------------------------------------------------------- midia

/**
 * Ordem de download. Capa primeiro: sem ela o post fica sem imagem e sem entrada
 * para a analise visual. Legenda .srt logo depois (minuscula, expira igual). Os
 * demais slides e os videos, pesados, por ultimo.
 */
const PRIORIDADE = sql`case
  when ${mediaAsset.kind} = 'image' and ${mediaAsset.position} = 0 then 0
  when ${mediaAsset.kind} = 'subtitle' then 1
  when ${mediaAsset.kind} = 'image' then 2
  else 3 end`

/**
 * Midias recentes que alguem pode baixar. O servidor nao sabe o que ja esta em
 * cada computador: o worker confere a pasta e baixa so o que falta.
 */
export async function midiasParaBaixar(limite: number): Promise<MidiaRemota[]> {
  const desde = new Date(Date.now() - MIDIA_FRESCA_DIAS * 86_400_000)
  const rows = await db
    .select({ id: mediaAsset.id, shortcode: post.shortcode, position: mediaAsset.position, kind: mediaAsset.kind, url: mediaAsset.remoteUrl })
    .from(mediaAsset)
    .innerJoin(post, eq(post.id, mediaAsset.postId))
    .where(and(lt(mediaAsset.downloadAttempts, MAX_TENTATIVAS), gte(post.lastSeenAt, desde), sql`${mediaAsset.remoteUrl} is not null`))
    .orderBy(PRIORIDADE, asc(mediaAsset.downloadAttempts), desc(post.lastSeenAt), asc(mediaAsset.position))
    .limit(limite)
  return rows.filter((r): r is MidiaRemota => Boolean(r.url))
}

export async function midiaBaixada(id: string): Promise<void> {
  await db.update(mediaAsset).set({ downloadedAt: new Date(), downloadError: null }).where(eq(mediaAsset.id, id))
}

export async function midiaFalhou(id: string, erro: string): Promise<void> {
  await db
    .update(mediaAsset)
    .set({ downloadAttempts: sql`${mediaAsset.downloadAttempts} + 1`, downloadError: erro.slice(0, 500) })
    .where(eq(mediaAsset.id, id))
}

const TRANSCRICAO = 'transcript'

/** posts recentes com legenda .srt do Instagram e sem a transcricao dela */
export async function legendasSemTexto(limite: number): Promise<MidiaDoPost[]> {
  const feito = alias(enrichment, 'feito')
  const desde = new Date(Date.now() - MIDIA_FRESCA_DIAS * 4 * 86_400_000)
  return db
    .select({ postId: post.id, shortcode: post.shortcode, position: mediaAsset.position })
    .from(mediaAsset)
    .innerJoin(post, eq(post.id, mediaAsset.postId))
    .leftJoin(feito, and(eq(feito.postId, post.id), eq(feito.kind, TRANSCRICAO), eq(feito.model, 'instagram')))
    .where(and(eq(mediaAsset.kind, 'subtitle'), isNull(feito.id), gte(post.lastSeenAt, desde)))
    .orderBy(desc(post.lastSeenAt))
    .limit(limite)
}

/**
 * Videos que ainda nao tem transcricao deste modelo. A fila vai do que importa
 * para a pauta (contas da persona, dentro da janela) para o resto, e do mais
 * novo para o mais velho. Limite 0 = todos.
 */
export async function videosSemTranscricao(modelo: string, fila: FilaWhisper, limite: number): Promise<MidiaDoPost[]> {
  const autores = (fila.autores ?? []).map((u) => u.toLowerCase())
  if (fila.somenteAutores && autores.length === 0) return []
  const feito = alias(enrichment, 'feito')
  const desde = fila.desdeDias ? Math.floor(Date.now() / 1000) - fila.desdeDias * 86_400 : 0
  const naLista = autores.length ? sql`lower(${author.username}) in (${sql.join(autores.map((u) => sql`${u}`), sql`, `)})` : null
  const recente = sql`coalesce(${post.takenAt}, 0) >= ${desde}`
  const q = db
    .select({ postId: post.id, shortcode: post.shortcode, position: mediaAsset.position })
    .from(mediaAsset)
    .innerJoin(post, eq(post.id, mediaAsset.postId))
    .leftJoin(author, eq(author.id, post.authorId))
    .leftJoin(feito, and(eq(feito.postId, post.id), eq(feito.kind, TRANSCRICAO), eq(feito.model, modelo)))
    .where(and(eq(mediaAsset.kind, 'video'), isNull(feito.id), ...(fila.somenteAutores && naLista ? [naLista, recente] : [])))
    // constante no ORDER BY e erro no Postgres: sem lista de contas, a ordem e so a data
    .orderBy(...(naLista ? [desc(naLista)] : []), ...(desde ? [desc(recente)] : []), desc(post.takenAt))
  return limite > 0 ? q.limit(limite) : q
}

export async function gravarTranscricao(postId: string, modelo: string, texto: string): Promise<void> {
  const output = texto ? { text: texto, chars: texto.length } : { text: '', chars: 0, semFala: true }
  await db
    .insert(enrichment)
    .values({ postId, kind: TRANSCRICAO, model: modelo, output })
    .onConflictDoUpdate({ target: [enrichment.postId, enrichment.kind, enrichment.model], set: { output, createdAt: new Date() } })
}

export async function apagarTranscricoesWhisper(): Promise<number> {
  const r = await db
    .delete(enrichment)
    .where(and(eq(enrichment.kind, TRANSCRICAO), like(enrichment.model, 'whisper:%')))
    .returning({ id: enrichment.id })
  return r.length
}
