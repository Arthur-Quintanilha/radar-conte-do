import type { RoteiroConteudo } from './api'

/** Textos e formatos usados nas telas (os mesmos do painel antigo). */

export const FORMATOS: Record<string, string> = {
  reels_fala: 'Reels falando',
  reels_bastidor: 'Reels bastidor',
  carrossel: 'Carrossel',
  foto_legenda: 'Foto + legenda',
  stories: 'Stories',
}

export const ENCAIXE: Record<string, string> = { dentro: 'Dentro', radar: 'Radar', fora: 'Fora' }

export const TIPO_POST: Record<string, string> = { image: 'Foto', carousel: 'Carrossel', video: 'Vídeo', reel: 'Reels' }

/** "reels_fala" -> "Reels falando"; formatos livres da IA ficam so com a primeira parte */
export function nomeFormato(f: string | null | undefined): string {
  if (!f) return ''
  return FORMATOS[f] ?? (f.split(/[,(—-]/)[0] ?? '').replace(/_/g, ' ').trim()
}

/** "2026-W41" -> "5 a 11 de out." (semana ISO, de segunda a domingo) */
export function rotuloSemana(sem: string | null | undefined): string {
  const m = /^(\d{4})-W(\d{1,2})$/.exec(sem ?? '')
  if (!m) return sem ?? ''
  const j4 = new Date(Date.UTC(Number(m[1]), 0, 4))
  const seg = new Date(j4.getTime() - ((j4.getUTCDay() + 6) % 7) * 86400000 + (Number(m[2]) - 1) * 7 * 86400000)
  const dom = new Date(seg.getTime() + 6 * 86400000)
  const mes = (d: Date) => new Intl.DateTimeFormat('pt-BR', { month: 'short', timeZone: 'UTC' }).format(d)
  if (seg.getUTCFullYear() !== dom.getUTCFullYear())
    return `${seg.getUTCDate()} de ${mes(seg)} de ${seg.getUTCFullYear()} a ${dom.getUTCDate()} de ${mes(dom)} de ${dom.getUTCFullYear()}`
  if (seg.getUTCMonth() === dom.getUTCMonth()) return `${seg.getUTCDate()} a ${dom.getUTCDate()} de ${mes(dom)}`
  return `${seg.getUTCDate()} de ${mes(seg)} a ${dom.getUTCDate()} de ${mes(dom)}`
}

/** "Hoje", "Ontem" ou "seg, 06 out" a partir de AAAA-MM-DD */
export function nomeDia(d: string | null | undefined, hoje: string | null | undefined): string {
  if (!d) return ''
  if (d === hoje) return 'Hoje'
  const ontem = new Date(`${hoje}T12:00:00`)
  ontem.setDate(ontem.getDate() - 1)
  const dt = new Date(`${d}T12:00:00`)
  if (dt.toDateString() === ontem.toDateString()) return 'Ontem'
  return new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' }).format(dt).replace(/\./g, '')
}

export const horaDe = (ts: number | null | undefined): string =>
  ts ? new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date(ts * 1000)) : ''

export const dataLonga = (ts: number | null | undefined): string =>
  ts ? new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(ts * 1000)) : ''

export const dataHora = (ts: number | null | undefined): string =>
  ts ? new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(ts * 1000)) : ''

const compacto = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 })
const inteiro = new Intl.NumberFormat('pt-BR')
export const numCurto = (n: number | null | undefined): string => (n === null || n === undefined ? '' : compacto.format(n))
export const numInteiro = (n: number | null | undefined): string => (n === null || n === undefined ? '' : inteiro.format(n))
export const vezes = (d: number): string => `${d.toFixed(1).replace('.', ',')}x`

export const linkPerfil = (u: string): string => `https://www.instagram.com/${encodeURIComponent(u)}/`
export const linkPost = (sc: string): string => `https://www.instagram.com/p/${encodeURIComponent(sc)}/`

export const ehVideo = (tipo: string | null | undefined): boolean => tipo === 'reel' || tipo === 'video' || tipo === '2'

/** carrossel e foto nao sao gravados: muda o que o roteiro mostra */
export function pecaDe(c: Pick<RoteiroConteudo, 'peca' | 'formato'>): 'reels' | 'carrossel' | 'foto' | 'stories' | string {
  if (c.peca) return c.peca
  const f = (c.formato ?? '').toLowerCase()
  return /carrossel|carousel|slide/.test(f) ? 'carrossel' : /\bfoto\b|imagem/.test(f) ? 'foto' : /stories/.test(f) ? 'stories' : 'reels'
}
export const ehGravado = (c: Pick<RoteiroConteudo, 'peca' | 'formato'>): boolean => !['carrossel', 'foto'].includes(pecaDe(c))

/** roteiros antigos tinham *enfase* e " / " de pausa: some, fica so o texto */
export const limparFala = (t: string): string => (t ?? '').replace(/\*([^*\n]+)\*/g, '$1').replace(/\s\/\s/g, ' ')

/** paragrafos de um texto (linha em branco ou quebra simples) */
export const paragrafos = (t: string | null | undefined): string[] =>
  (t ?? '')
    .split(/\n\s*\n|\n/)
    .map((p) => p.trim())
    .filter(Boolean)

/** pedacos de um texto com os [PREENCHER ...] marcados, para destacar no template */
export function trechos(t: string | null | undefined): { texto: string; preencher: boolean }[] {
  const s = t ?? ''
  const out: { texto: string; preencher: boolean }[] = []
  const re = /\[PREENCHER[^\]]*\]/gi
  let ult = 0
  for (const m of s.matchAll(re)) {
    if (m.index! > ult) out.push({ texto: s.slice(ult, m.index), preencher: false })
    out.push({ texto: m[0], preencher: true })
    ult = m.index! + m[0].length
  }
  if (ult < s.length) out.push({ texto: s.slice(ult), preencher: false })
  return out
}

/** localStorage que nao quebra em janela anonima */
export const guardado = {
  ler(chave: string): string | null {
    try {
      return localStorage.getItem(chave)
    } catch {
      return null
    }
  },
  gravar(chave: string, v: string | null): void {
    try {
      if (v === null) localStorage.removeItem(chave)
      else localStorage.setItem(chave, v)
    } catch {
      /* sem storage */
    }
  },
}
