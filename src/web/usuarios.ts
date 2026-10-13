import { and, asc, eq, inArray } from 'drizzle-orm'
import { db } from '../db/client'
import { acesso, ideia, persona, roteiro, usuario } from '../db/schema'
import { ativarPersona, personaAtiva } from '../creator/persona'
import { acharLogin, bloquearLogin, criarLogin, trocarSenha } from './supabase'

export type Papel = 'admin' | 'membro'

/** Quem esta fazendo o pedido. `local` = painel antigo sem login (PAINEL_SEM_LOGIN=1). */
export interface Quem {
  id: string
  email: string
  papel: Papel
  local?: boolean
}

export const ADMIN_LOCAL: Quem = { id: 'local', email: 'local', papel: 'admin', local: true }

export async function quemE(id: string): Promise<Quem | null> {
  const [u] = await db.select().from(usuario).where(eq(usuario.id, id)).limit(1)
  if (!u || !u.ativo) return null
  return { id: u.id, email: u.email, papel: u.papel }
}

/** Ids dos creators que essa pessoa pode ver. null = todos (admin). */
export async function personasDe(q: Quem): Promise<string[] | null> {
  if (q.papel === 'admin') return null
  const r = await db.select({ id: acesso.personaId }).from(acesso).where(eq(acesso.usuarioId, q.id))
  return r.map((x) => x.id)
}

export async function podeVer(q: Quem, personaId: string | null | undefined): Promise<boolean> {
  if (q.papel === 'admin') return true
  if (!personaId) return false
  const [r] = await db
    .select({ id: acesso.personaId })
    .from(acesso)
    .where(and(eq(acesso.usuarioId, q.id), eq(acesso.personaId, personaId)))
    .limit(1)
  return Boolean(r)
}

/**
 * O creator que essa pessoa esta vendo. Cada login guarda o seu; se o guardado
 * sumiu ou perdeu o acesso, cai no primeiro liberado. O admin local (painel
 * antigo) continua usando a marca global, como o terminal.
 */
export async function personaAtualDe(q: Quem): Promise<string | null> {
  if (q.local) return (await personaAtiva())?.id ?? null
  const [u] = await db.select({ p: usuario.personaAtual }).from(usuario).where(eq(usuario.id, q.id)).limit(1)
  const permitidas = await personasDe(q)
  if (u?.p && (!permitidas || permitidas.includes(u.p))) return u.p
  if (permitidas) return permitidas[0] ?? null
  const global = (await personaAtiva())?.id
  if (global) return global
  const [primeira] = await db.select({ id: persona.id }).from(persona).orderBy(asc(persona.createdAt)).limit(1)
  return primeira?.id ?? null
}

/** Libera um creator para essa pessoa (ex.: o que ela acabou de criar). */
export async function darAcesso(q: Quem, personaId: string): Promise<void> {
  if (q.local) return
  await db.insert(acesso).values({ usuarioId: q.id, personaId }).onConflictDoNothing()
}

/** Troca o creator que essa pessoa ve. Nao mexe no de mais ninguem. */
export async function escolherPersona(q: Quem, personaId: string): Promise<void> {
  if (!(await podeVer(q, personaId))) throw new Error('voce nao tem acesso a esse creator')
  const [p] = await db.select({ id: persona.id }).from(persona).where(eq(persona.id, personaId)).limit(1)
  if (!p) throw new Error('creator nao encontrado')
  if (q.local) await ativarPersona(personaId)
  else await db.update(usuario).set({ personaAtual: personaId }).where(eq(usuario.id, q.id))
}

export async function personaDaIdeia(id: string): Promise<string | null> {
  const [r] = await db.select({ p: ideia.personaId }).from(ideia).where(eq(ideia.id, id)).limit(1)
  return r?.p ?? null
}

export async function personaDoRoteiro(id: string): Promise<string | null> {
  const [r] = await db.select({ p: roteiro.personaId }).from(roteiro).where(eq(roteiro.id, id)).limit(1)
  return r?.p ?? null
}

// ---- administracao ----

export interface UsuarioLinha {
  id: string
  email: string
  nome: string | null
  papel: Papel
  ativo: boolean
  personas: string[]
  createdAt: Date
}

export async function listarUsuarios(): Promise<UsuarioLinha[]> {
  const us = await db.select().from(usuario).orderBy(asc(usuario.createdAt))
  const acs = us.length ? await db.select().from(acesso).where(inArray(acesso.usuarioId, us.map((u) => u.id))) : []
  return us.map((u) => ({ ...u, personas: acs.filter((a) => a.usuarioId === u.id).map((a) => a.personaId) }))
}

function validarEmail(email: string): string {
  const e = email.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new Error('e-mail invalido')
  return e
}

function validarSenha(senha: string): void {
  if (senha.length < 8) throw new Error('a senha precisa de pelo menos 8 caracteres')
}

/**
 * Cadastra alguem: cria o login no Supabase (ou reaproveita, se o e-mail ja
 * existe la) e a linha local com papel e creators liberados.
 */
export async function criarUsuario(dados: { email: string; senha?: string; nome?: string; papel?: Papel; personas?: string[] }): Promise<UsuarioLinha> {
  const email = validarEmail(dados.email)
  const [jaTem] = await db.select({ id: usuario.id }).from(usuario).where(eq(usuario.email, email)).limit(1)
  if (jaTem) throw new Error('esse e-mail ja esta cadastrado')
  let login = await acharLogin(email)
  if (!login) {
    if (!dados.senha) throw new Error('senha obrigatoria para um login novo')
    validarSenha(dados.senha)
    login = await criarLogin(email, dados.senha)
  }
  await db
    .insert(usuario)
    .values({ id: login.id, email, nome: dados.nome?.trim() || null, papel: dados.papel ?? 'membro' })
    .onConflictDoUpdate({ target: usuario.id, set: { email, ativo: true } })
  await definirAcesso(login.id, dados.personas ?? [])
  const [u] = (await listarUsuarios()).filter((x) => x.id === login.id)
  return u!
}

export async function definirAcesso(usuarioId: string, personas: string[]): Promise<void> {
  const validas = personas.length ? (await db.select({ id: persona.id }).from(persona).where(inArray(persona.id, personas))).map((p) => p.id) : []
  await db.transaction(async (tx) => {
    await tx.delete(acesso).where(eq(acesso.usuarioId, usuarioId))
    if (validas.length) await tx.insert(acesso).values(validas.map((personaId) => ({ usuarioId, personaId })))
  })
}

export async function atualizarUsuario(id: string, dados: { nome?: string | null; papel?: Papel; ativo?: boolean; senha?: string }, quem: Quem): Promise<void> {
  const [u] = await db.select().from(usuario).where(eq(usuario.id, id)).limit(1)
  if (!u) throw new Error('usuario nao encontrado')
  if (id === quem.id && (dados.ativo === false || dados.papel === 'membro')) throw new Error('voce nao pode tirar o proprio acesso de admin')
  if (dados.senha) {
    validarSenha(dados.senha)
    await trocarSenha(id, dados.senha)
  }
  if (dados.ativo !== undefined && dados.ativo !== u.ativo) await bloquearLogin(id, !dados.ativo)
  const set: Partial<typeof usuario.$inferInsert> = {}
  if (dados.nome !== undefined) set.nome = dados.nome?.trim() || null
  if (dados.papel) set.papel = dados.papel
  if (dados.ativo !== undefined) set.ativo = dados.ativo
  if (Object.keys(set).length) await db.update(usuario).set(set).where(eq(usuario.id, id))
}

/** Primeiro admin, pela linha de comando: o e-mail ja precisa existir no Supabase (ou passe a senha). */
export async function tornarAdmin(email: string, senha?: string): Promise<UsuarioLinha> {
  const e = validarEmail(email)
  let login = await acharLogin(e)
  if (!login) {
    if (!senha) throw new Error(`nao achei ${e} no Supabase: crie em Authentication > Users ou passe --senha`)
    validarSenha(senha)
    login = await criarLogin(e, senha)
  }
  await db
    .insert(usuario)
    .values({ id: login.id, email: e, papel: 'admin' })
    .onConflictDoUpdate({ target: usuario.id, set: { papel: 'admin', ativo: true, email: e } })
  return (await listarUsuarios()).find((x) => x.id === login.id)!
}
