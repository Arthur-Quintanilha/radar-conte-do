import { sql } from 'drizzle-orm'
import { db } from '../db/client'
import { config } from '../shared/config'
import { papeisEfetivos } from './grafo'
import { sementesComLista } from './persona'
import { referenciasAtivas } from './referencias'
import type { Territorio } from './tipos'

export const corta = (t: string | null | undefined, n: number): string => {
  const limpo = (t ?? '').replace(/\s+/g, ' ').trim()
  return limpo.length > n ? `${limpo.slice(0, n - 1)}…` : limpo
}

/** Contas que o publico consome, segundo a IA ou a sua correcao. */
export function consumidos(personaId: string): string[] {
  return [...papeisEfetivos(personaId).entries()].filter(([, v]) => v.papel === 'consumido').map(([u]) => u)
}

/** De onde vem o assunto da pauta: contas consumidas pelo publico + referencias de conteudo. */
export function fontesConteudo(personaId: string): string[] {
  return [...new Set([...consumidos(personaId), ...referenciasAtivas(personaId)])]
}

export interface PostJanela {
  id: string
  shortcode: string
  tipo: string | null
  caption: string | null
  takenAt: number | null
  autor: string
  autorNome: string | null
  autorTema: string | null
  likes: number | null
  comments: number | null
  plays: number | null
  fala: string | null
  /** quando a fala chegou (segundos): transcricao que chegou depois do encaixe pede reavaliacao */
  falaEm: number | null
  alt: string | null
  thumb: string | null
  /** referencia: conta que voce cadastrou como referencia de conteudo; grafo: conta consumida pelo publico */
  origem: 'referencia' | 'grafo'
}

const lista = (xs: string[]) => sql.join(xs.map((x) => sql`${x}`), sql`, `)

/** Posts das contas consumidas publicados dentro da janela (JANELA_DIAS). */
export function postsJanela(personaId: string, autores = fontesConteudo(personaId), dias = config.JANELA_DIAS): PostJanela[] {
  if (autores.length === 0) return []
  const desde = Math.floor(Date.now() / 1000) - dias * 86_400
  const refs = new Set(referenciasAtivas(personaId))
  const rows = db.all<Omit<PostJanela, 'origem'>>(sql`
    select p.id, p.shortcode, p.media_type as tipo, p.caption, p.taken_at as takenAt,
      lower(a.username) as autor, a.full_name as autorNome,
      (select tema from persona_conta c where c.persona_id = ${personaId} and c.username = lower(a.username) and c.source = 'llm') as autorTema,
      (select m.like_count from post_metric m where m.post_id = p.id order by m.captured_at desc limit 1) as likes,
      (select m.comment_count from post_metric m where m.post_id = p.id order by m.captured_at desc limit 1) as comments,
      (select m.play_count from post_metric m where m.post_id = p.id order by m.captured_at desc limit 1) as plays,
      (select json_extract(e.output, '$.text') from enrichment e where e.post_id = p.id and e.kind = 'transcript'
        and coalesce(json_extract(e.output, '$.text'), '') <> '' order by e.model like 'whisper%' desc limit 1) as fala,
      (select max(e.created_at) from enrichment e where e.post_id = p.id and e.kind = 'transcript'
        and coalesce(json_extract(e.output, '$.text'), '') <> '') as falaEm,
      (select json_extract(e.output, '$.text') from enrichment e where e.post_id = p.id and e.kind = 'alt_text' limit 1) as alt,
      (select '/media/' || ma.id from media_asset ma where ma.post_id = p.id and ma.kind = 'image' and ma.position = 0
        and ma.local_path is not null limit 1) as thumb
    from post p join author a on a.id = p.author_id
    where lower(a.username) in (${lista(autores)})
      and p.taken_at >= ${desde}
    order by p.taken_at desc
  `)
  return rows.map((r) => ({ ...r, origem: refs.has(r.autor) ? 'referencia' : 'grafo' }))
}

/**
 * Versao com que o encaixe foi avaliado: muda quando o territorio muda OU
 * quando a regra do prompt muda (ENCAIXE_REGRA). Mudou, o post e reavaliado.
 */
export const ENCAIXE_REGRA = 2
export const versaoEncaixe = (territorioVersao: number): number => territorioVersao * 1000 + ENCAIXE_REGRA

export interface EncaixeEfetivo {
  encaixe: string
  source: string
  tema: string | null
  temaTerritorio: string | null
  angulo: string | null
  radarTema: string | null
  confianca: number | null
  motivo: string | null
  /** versao do territorio com que a IA avaliou (null se nunca avaliou) */
  versaoLlm: number | null
  /** quando a IA avaliou (segundos) */
  avaliadoEm: number | null
}

/** Encaixe de cada post para a persona: a sua correcao vale sobre a IA. */
export function encaixesDe(personaId: string): Map<string, EncaixeEfetivo> {
  const rows = db.all<{
    postId: string
    source: string
    encaixe: string
    tema: string | null
    temaTerritorio: string | null
    angulo: string | null
    radarTema: string | null
    confianca: number | null
    motivo: string | null
    versao: number
    avaliadoEm: number
  }>(sql`
    select post_id as postId, source, encaixe, tema, tema_territorio as temaTerritorio, angulo, radar_tema as radarTema,
      confianca, motivo, territorio_versao as versao, created_at as avaliadoEm
    from encaixe where persona_id = ${personaId}
  `)
  const llm = new Map(rows.filter((r) => r.source === 'llm').map((r) => [r.postId, r]))
  const hum = new Map(rows.filter((r) => r.source === 'humano').map((r) => [r.postId, r]))
  const m = new Map<string, EncaixeEfetivo>()
  for (const id of new Set([...llm.keys(), ...hum.keys()])) {
    const l = llm.get(id)
    const h = hum.get(id)
    const base = l ?? h
    if (!base) continue
    m.set(id, {
      encaixe: h?.encaixe ?? base.encaixe,
      source: h ? 'humano' : 'llm',
      tema: l?.tema ?? h?.tema ?? null,
      temaTerritorio: l?.temaTerritorio ?? null,
      angulo: l?.angulo ?? null,
      radarTema: h?.radarTema ?? l?.radarTema ?? null,
      confianca: h ? 1 : (l?.confianca ?? null),
      motivo: l?.motivo ?? null,
      versaoLlm: l?.versao ?? null,
      avaliadoEm: l?.avaliadoEm ?? null,
    })
  }
  return m
}

/** Engajamento (curtidas + comentarios) de todos os posts de cada autor no banco. */
export function historicoEngajamento(autores: string[]): Map<string, number[]> {
  const m = new Map<string, number[]>()
  if (autores.length === 0) return m
  const rows = db.all<{ autor: string; likes: number | null; comments: number | null }>(sql`
    select lower(a.username) as autor,
      (select m.like_count from post_metric m where m.post_id = p.id order by m.captured_at desc limit 1) as likes,
      (select m.comment_count from post_metric m where m.post_id = p.id order by m.captured_at desc limit 1) as comments
    from post p join author a on a.id = p.author_id
    where lower(a.username) in (${lista(autores)})
  `)
  for (const r of rows) {
    if (r.likes === null) continue
    const l = m.get(r.autor) ?? []
    l.push(r.likes + (r.comments ?? 0))
    m.set(r.autor, l)
  }
  return m
}

/** Quantas sementes (com lista coletada) seguem cada conta. */
export async function sementesPorAutor(personaId: string): Promise<{ total: number; mapa: Map<string, number> }> {
  const sementes = await sementesComLista(personaId)
  if (sementes.length === 0) return { total: 0, mapa: new Map() }
  const rows = db.all<{ username: string; n: number }>(sql`
    select username, count(distinct semente) as n from seguindo
    where semente in (${lista(sementes)}) group by username
  `)
  return { total: sementes.length, mapa: new Map(rows.map((r) => [r.username, r.n])) }
}

/** O territorio em texto, para os prompts. */
export function territorioTexto(t: Territorio, nome: string): string {
  const itens = (xs: { tema: string; detalhe: string }[]) => xs.map((x) => `- **${x.tema}**${x.detalhe ? `: ${x.detalhe}` : ''}`).join('\n') || '- (nenhum)'
  const simples = (xs: string[]) => xs.map((x) => `- ${x}`).join('\n') || '- (nenhum)'
  return `### Quem é ${nome}
${t.resumo || '(sem resumo)'}

### Quem ${nome} quer atrair
${t.publico || '(não informado)'}

### Temas profissionais (onde tem o que dizer)
${itens(t.temas)}

### Lado pessoal que topa mostrar
${itens(t.pessoal)}

### Opiniões fortes
${simples(t.opinioes)}

### Histórias que já conta
${simples(t.historias)}

### Tom
${t.tom || '(não informado)'}

### Formatos em que fica à vontade
${simples(t.formatos)}

### FORA (nunca sugerir, escrito pelo próprio creator)
${simples(t.fora)}`
}
