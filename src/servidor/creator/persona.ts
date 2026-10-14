import { and, asc, desc, eq, sql } from 'drizzle-orm'
import { all, db } from '../db/client'
import { persona, semente } from '../db/schema'
import { territorio as territorioSchema, type Territorio } from '../../comum/tipos'

export type Persona = typeof persona.$inferSelect

export const normalizarUsername = (u: string): string => u.replace(/^@/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/[/?#].*$/, '').trim().toLowerCase()
export const usernameValido = (u: string): boolean => /^[a-z0-9._]{1,30}$/.test(u)

export async function listarPersonas(): Promise<Persona[]> {
  return db.select().from(persona).orderBy(desc(persona.ativa), asc(persona.createdAt))
}

export async function getPersona(id: string): Promise<Persona | null> {
  const [p] = await db.select().from(persona).where(eq(persona.id, id)).limit(1)
  return p ?? null
}

/**
 * O creator "ativo" do terminal. Quando o painel dispara uma etapa, ele passa
 * PERSONA_ID com o creator de quem clicou: cada login tem o seu, e a marca
 * global `ativa` fica so para o terminal e o painel antigo.
 */
export async function personaAtiva(): Promise<Persona | null> {
  const doPainel = process.env['PERSONA_ID']
  if (doPainel) return getPersona(doPainel)
  const [p] = await db.select().from(persona).where(eq(persona.ativa, true)).limit(1)
  return p ?? null
}

/** A ativa, ou erro explicando o que fazer. */
export async function exigirPersona(id?: string): Promise<Persona> {
  const p = id ? await getPersona(id) : await personaAtiva()
  if (!p) throw new Error(id ? `persona ${id} nao existe` : 'nenhuma persona ativa: crie uma na aba Creator do painel (ou npm run persona -- criar "Nome")')
  return p
}

export function territorioDe(p: Pick<Persona, 'territorio'>): Territorio | null {
  if (!p.territorio) return null
  const r = territorioSchema.safeParse(p.territorio)
  return r.success ? r.data : null
}

/** "Fora" vem da entrevista: um tema por linha, ou separados por ; ou virgula. So o creator escreve isso. */
export function foraDaEntrevista(entrevista: Record<string, string>): string[] {
  return (entrevista['fora'] ?? '')
    .split(/[\n;,]/)
    .map((l) => l.replace(/^[-*•\s]+/, '').replace(/[\s.]+$/, '').trim())
    .filter(Boolean)
    .slice(0, 30)
}

export async function criarPersona(nome: string, handle?: string | null): Promise<Persona> {
  const temAtiva = (await personaAtiva()) !== null
  const [p] = await db
    .insert(persona)
    .values({ nome: nome.trim(), handle: handle ? normalizarUsername(handle) : null, ativa: !temAtiva })
    .returning()
  if (!p) throw new Error('nao foi possivel criar a persona')
  return p
}

export async function ativarPersona(id: string): Promise<void> {
  await exigirPersona(id)
  await db.transaction(async (tx) => {
    await tx.update(persona).set({ ativa: false }).where(eq(persona.ativa, true))
    await tx.update(persona).set({ ativa: true }).where(eq(persona.id, id))
  })
}

export async function atualizarPersona(
  id: string,
  dados: { nome?: string; handle?: string | null; entrevista?: Record<string, string> },
): Promise<Persona> {
  const atual = await exigirPersona(id)
  const set: Partial<typeof persona.$inferInsert> = { updatedAt: new Date() }
  if (dados.nome !== undefined && dados.nome.trim()) set.nome = dados.nome.trim()
  if (dados.handle !== undefined) set.handle = dados.handle ? normalizarUsername(dados.handle) : null
  if (dados.entrevista) {
    const limpa: Record<string, string> = {}
    for (const [k, v] of Object.entries(dados.entrevista)) if (typeof v === 'string') limpa[k] = v.slice(0, 6_000)
    set.entrevista = limpa
    set.publico = limpa['publico']?.trim() || null
    // o "fora" da entrevista vale direto no territorio, sem passar pela IA
    const t = territorioDe(atual)
    if (t) {
      const fora = foraDaEntrevista(limpa)
      if (JSON.stringify(fora) !== JSON.stringify(t.fora)) {
        set.territorio = { ...t, fora }
        set.territorioVersao = atual.territorioVersao + 1
      }
    }
  }
  const [p] = await db.update(persona).set(set).where(eq(persona.id, id)).returning()
  if (!p) throw new Error('persona sumiu')
  return p
}

/** Grava o territorio (validado) e sobe a versao: o encaixe dos posts e refeito. */
export async function salvarTerritorio(id: string, bruto: unknown): Promise<Persona> {
  const atual = await exigirPersona(id)
  const t = territorioSchema.parse(bruto)
  const antes = territorioDe(atual)
  const mudou = JSON.stringify(antes) !== JSON.stringify(t)
  const [p] = await db
    .update(persona)
    .set({ territorio: t, updatedAt: new Date(), ...(mudou ? { territorioVersao: atual.territorioVersao + 1 } : {}) })
    .where(eq(persona.id, id))
    .returning()
  if (!p) throw new Error('persona sumiu')
  return p
}

/* ------------------------------------------------------------ sementes */

export type Semente = typeof semente.$inferSelect

export async function listarSementes(personaId: string): Promise<Semente[]> {
  return db.select().from(semente).where(eq(semente.personaId, personaId)).orderBy(asc(semente.status), asc(semente.username))
}

export interface AddResult {
  adicionadas: string[]
  jaExistiam: string[]
  invalidas: string[]
}

/**
 * Aceita @, nome solto ou link do perfil, separados por linha, virgula ou
 * espaco. Semente sugerida pelo grafo nunca rebaixa uma que voce confirmou.
 */
export async function adicionarSementes(
  personaId: string,
  texto: string | string[],
  opts: { origem?: 'voce' | 'grafo'; status?: 'confirmada' | 'sugerida'; motivo?: string | null } = {},
): Promise<AddResult> {
  const brutos = Array.isArray(texto) ? texto : texto.split(/[\s,;]+/)
  const r: AddResult = { adicionadas: [], jaExistiam: [], invalidas: [] }
  const vistos = new Set<string>()
  for (const b of brutos) {
    if (!b.trim()) continue
    const u = normalizarUsername(b)
    if (!usernameValido(u)) {
      r.invalidas.push(b.trim())
      continue
    }
    if (vistos.has(u)) continue
    vistos.add(u)
    const status = opts.status ?? 'confirmada'
    const [existente] = await db.select().from(semente).where(and(eq(semente.personaId, personaId), eq(semente.username, u))).limit(1)
    if (existente) {
      // voce cadastrando de novo uma sugerida ou rejeitada: vira confirmada
      if (status === 'confirmada' && existente.status !== 'confirmada' && (opts.origem ?? 'voce') === 'voce') {
        await db.update(semente).set({ status: 'confirmada' }).where(eq(semente.id, existente.id))
        r.adicionadas.push(u)
      } else r.jaExistiam.push(u)
      continue
    }
    await db.insert(semente).values({ personaId, username: u, status, origem: opts.origem ?? 'voce', motivo: opts.motivo ?? null })
    r.adicionadas.push(u)
  }
  return r
}

export async function setStatusSemente(personaId: string, username: string, status: 'confirmada' | 'rejeitada' | 'remover'): Promise<boolean> {
  const u = normalizarUsername(username)
  const where = and(eq(semente.personaId, personaId), eq(semente.username, u))
  if (status === 'remover') {
    const rows = await db.delete(semente).where(where).returning({ id: semente.id })
    return rows.length > 0
  }
  const rows = await db.update(semente).set({ status }).where(where).returning({ id: semente.id })
  return rows.length > 0
}

export async function sementesConfirmadas(personaId: string): Promise<string[]> {
  const rows = await db
    .select({ u: semente.username })
    .from(semente)
    .where(and(eq(semente.personaId, personaId), eq(semente.status, 'confirmada')))
  return rows.map((r) => r.u)
}

/** Sementes confirmadas que ja tem lista coletada: sao elas que contam no grafo. */
export async function sementesComLista(personaId: string): Promise<string[]> {
  const rows = await all<{ u: string }>(sql`
    select s.username as u from semente s
    where s.persona_id = ${personaId} and s.status = 'confirmada'
      and exists (select 1 from seguindo g where g.semente = s.username)
  `)
  return rows.map((r) => r.u)
}
