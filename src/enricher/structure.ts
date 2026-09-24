import type Anthropic from '@anthropic-ai/sdk'
import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { and, eq, isNotNull, isNull, or, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import { db } from '../db/client'
import { enrichment, mediaAsset, post } from '../db/schema'
import { anthropic } from './anthropic'
import { hasLocalFile } from './download'
import { config } from '../shared/config'
import { logger } from '../shared/logger'

export const STRUCTURE_KIND = 'structure'

const SYSTEM = [
  'Voce analisa posts do Instagram para alimentar um sistema de recomendacao de conteudo.',
  'Responda sempre chamando a ferramenta registrar_analise, nunca com texto solto.',
  'Seja literal: hook e texto_na_tela sao transcricoes, nao parafrases.',
  'Se um campo nao se aplica, use string vazia. Nao invente.',
].join(' ')

const ANALYSIS_TOOL = {
  name: 'registrar_analise',
  description: 'Registra a analise estruturada de um post do Instagram.',
  input_schema: {
    type: 'object' as const,
    properties: {
      tema: { type: 'string', description: 'assunto central em 1 a 3 palavras' },
      subtema: { type: 'string', description: 'recorte especifico dentro do tema' },
      formato: {
        type: 'string',
        enum: ['tutorial', 'bastidores', 'opiniao', 'lista', 'case', 'humor', 'noticia', 'citacao', 'anuncio', 'outro'],
      },
      hook: { type: 'string', description: 'a primeira frase da legenda ou o texto de maior destaque na imagem, literal' },
      tipo_de_hook: {
        type: 'string',
        enum: ['pergunta', 'numero', 'contradicao', 'promessa', 'historia', 'citacao', 'outro'],
      },
      estrutura: {
        type: 'array',
        items: { type: 'string' },
        description: 'as partes do post em ordem, ex: abertura, desenvolvimento, virada, cta',
      },
      cta: { type: 'string', description: 'a chamada para acao, literal; vazio se nao houver' },
      tom: { type: 'string', description: 'ex: inspiracional, tecnico, provocativo, intimista' },
      publico_alvo: { type: 'string' },
      promessa: { type: 'string', description: 'o que o post promete entregar, em uma frase' },
      texto_na_tela: { type: 'string', description: 'todo o texto legivel na imagem, transcrito; vazio se nao houver' },
      tem_rosto: { type: 'boolean' },
      idioma: { type: 'string', description: 'codigo curto, ex: pt, en, es' },
    },
    required: [
      'tema', 'formato', 'hook', 'tipo_de_hook', 'estrutura',
      'tom', 'publico_alvo', 'promessa', 'texto_na_tela', 'tem_rosto', 'idioma',
    ],
  },
}

export interface EnrichSummary {
  candidates: number
  analyzed: number
  withImage: number
  textOnly: number
  failed: number
  inputTokens: number
  outputTokens: number
}

interface Candidate {
  id: string
  shortcode: string
  caption: string | null
  mediaType: string | null
  imagePath: string | null
  altText: unknown
}

function mediaTypeOf(path: string): 'image/png' | 'image/webp' | 'image/jpeg' {
  const ext = extname(path).toLowerCase()
  if (ext === '.png') return 'image/png'
  if (ext === '.webp') return 'image/webp'
  return 'image/jpeg'
}

async function pending(limit: number, model: string): Promise<Candidate[]> {
  const done = alias(enrichment, 'done')
  const alt = alias(enrichment, 'alt')
  const cover = alias(mediaAsset, 'cover')

  return db
    .select({
      id: post.id,
      shortcode: post.shortcode,
      caption: post.caption,
      mediaType: post.mediaType,
      imagePath: cover.localPath,
      altText: alt.output,
    })
    .from(post)
    .leftJoin(done, and(eq(done.postId, post.id), eq(done.kind, STRUCTURE_KIND), eq(done.model, model)))
    .leftJoin(alt, and(eq(alt.postId, post.id), eq(alt.kind, 'alt_text')))
    .leftJoin(cover, and(eq(cover.postId, post.id), eq(cover.position, 0), eq(cover.kind, 'image')))
    .where(and(isNull(done.id), or(isNotNull(post.caption), isNotNull(cover.localPath))))
    .orderBy(sql`${post.firstSeenAt} desc`)
    .limit(limit)
}

function altTextOf(value: unknown): string | undefined {
  if (value !== null && typeof value === 'object' && 'text' in value) {
    const text = (value as { text?: unknown }).text
    if (typeof text === 'string') return text
  }
  return undefined
}

async function analyze(candidate: Candidate, model: string) {
  const content: Anthropic.MessageParam['content'] = []

  if (candidate.imagePath && hasLocalFile(candidate.imagePath)) {
    const buffer = await readFile(candidate.imagePath)
    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: mediaTypeOf(candidate.imagePath),
        data: buffer.toString('base64'),
      },
    })
  }

  const alt = altTextOf(candidate.altText)
  const parts = [
    `Tipo de midia: ${candidate.mediaType ?? 'desconhecido'}`,
    alt ? `Texto alternativo do Instagram: ${alt}` : null,
    candidate.caption ? `Legenda:\n${candidate.caption}` : 'Sem legenda.',
    'Analise este post e chame registrar_analise.',
  ].filter((p): p is string => p !== null)

  content.push({ type: 'text', text: parts.join('\n\n') })

  return anthropic().messages.create({
    model,
    max_tokens: 1_200,
    system: SYSTEM,
    tools: [ANALYSIS_TOOL],
    tool_choice: { type: 'tool', name: ANALYSIS_TOOL.name },
    messages: [{ role: 'user', content }],
  })
}

/** Pool simples: processa `size` candidatos ao mesmo tempo. */
async function pool<T>(items: T[], size: number, worker: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items]
  const runners = Array.from({ length: Math.min(size, queue.length) }, async () => {
    for (;;) {
      const item = queue.shift()
      if (item === undefined) return
      await worker(item)
    }
  })
  await Promise.all(runners)
}

export async function enrichPending(limit = 30): Promise<EnrichSummary> {
  // checa antes do pool: sem isso o mesmo erro aparece uma vez por post
  if (!config.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY nao configurada. Crie o arquivo .env a partir de .env.example e preencha a chave.')
  }

  const model = config.ANTHROPIC_MODEL
  const candidates = await pending(limit, model)

  const summary: EnrichSummary = {
    candidates: candidates.length,
    analyzed: 0,
    withImage: 0,
    textOnly: 0,
    failed: 0,
    inputTokens: 0,
    outputTokens: 0,
  }

  if (candidates.length === 0) return summary

  await pool(candidates, config.ENRICH_CONCURRENCY, async (candidate) => {
    try {
      const hadImage = candidate.imagePath !== null && hasLocalFile(candidate.imagePath)
      const response = await analyze(candidate, model)

      const block = response.content.find((b) => b.type === 'tool_use')
      if (!block || block.type !== 'tool_use') {
        throw new Error('o modelo nao chamou a ferramenta')
      }

      await db
        .insert(enrichment)
        .values({ postId: candidate.id, kind: STRUCTURE_KIND, model, output: block.input })
        .onConflictDoUpdate({
          target: [enrichment.postId, enrichment.kind, enrichment.model],
          set: { output: block.input, createdAt: new Date() },
        })

      summary.analyzed++
      if (hadImage) summary.withImage++
      else summary.textOnly++
      summary.inputTokens += response.usage.input_tokens
      summary.outputTokens += response.usage.output_tokens

      logger.info({ shortcode: candidate.shortcode, comImagem: hadImage }, 'post analisado')
    } catch (error) {
      summary.failed++
      logger.warn(
        { shortcode: candidate.shortcode, erro: error instanceof Error ? error.message : String(error) },
        'falha ao analisar post',
      )
    }
  })

  return summary
}
