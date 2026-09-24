import { Command } from 'commander'
import { sql } from 'drizzle-orm'
import { closeDb, db } from '../db/client'
import { collectionRun, post, rawResponse } from '../db/schema'
import { runLogin } from '../session/login'
import { launchContext } from '../session/browser'
import { checkHealth } from '../session/health'
import { runCollection } from '../collector/explore'
import { runAuthorSync } from '../collector/authors'
import { parsePending, resetParsed } from '../parser/run'
import { downloadPending } from '../enricher/download'
import { enrichPending } from '../enricher/structure'
import { ingestSubtitles } from '../enricher/transcript'
import { checkTools, resetWhisper, transcribeVideos } from '../enricher/whisper'
import { listModels } from '../enricher/anthropic'
import { describeDb, runSql } from '../inspect/db'
import { exportTranscripts, printTranscripts } from '../inspect/transcripts'
import { startPainel } from '../painel/server'
import { closeStaleRuns, purgeNonExplore } from '../maintenance/purge'
import { breakerStatus, resetBreaker } from '../collector/breaker'
import { checkBudget, isRestDay, shouldRunThisHour } from '../shared/budget'
import { localDayKey } from '../shared/time'
import { isStopRequested } from '../shared/stop'
import { logger } from '../shared/logger'

const program = new Command()

program.name('ig-insights').description('Coletor do Explorar do Instagram').version('0.1.0')

program
  .command('login')
  .description('abre o Chrome para login manual e salva a sessao no perfil persistente')
  .action(async () => {
    const ok = await runLogin()
    process.exitCode = ok ? 0 : 1
  })

program
  .command('health')
  .description('verifica se a sessao esta viva e se o Instagram esta respondendo normal')
  .action(async () => {
    const context = await launchContext()
    try {
      const result = await checkHealth(context)
      logger.info(result, 'health check')
      process.exitCode = result.status === 'ok' ? 0 : 1
    } finally {
      await context.close()
    }
  })

program
  .command('collect')
  .description('roda uma sessao de coleta no Explorar')
  .option('--force', 'ignora orcamento e circuit breaker (use com consciencia)', false)
  .option('--scrolls <n>', 'numero maximo de scrolls', (v) => Number(v))
  .action(async (opts: { force: boolean; scrolls?: number }) => {
    const summary = await runCollection({
      force: opts.force,
      maxScrolls: opts.scrolls,
    })
    process.exitCode = summary.status === 'failed' ? 1 : 0
  })

program
  .command('authors')
  .description('visita perfis de autores para preencher o numero de seguidores')
  .option('--force', 'ignora orcamento e circuit breaker', false)
  .option('--limit <n>', 'quantos perfis visitar', (v) => Number(v))
  .action(async (opts: { force: boolean; limit?: number }) => {
    const summary = await runAuthorSync({ force: opts.force, limit: opts.limit })
    process.exitCode = summary.status === 'failed' ? 1 : 0
  })

program
  .command('plan')
  .description('decide probabilisticamente se esta hora vira sessao; use no cron horario')
  .action(async () => {
    const decision = await shouldRunThisHour()
    if (!decision.allowed) {
      logger.info({ reason: decision.reason }, 'esta hora nao vira sessao')
      return
    }
    logger.info({ reason: decision.reason }, 'hora sorteada, iniciando coleta')
    await runCollection()
  })

program
  .command('parse')
  .description('processa as respostas brutas ainda nao parseadas')
  .option('--limit <n>', 'quantas respostas processar', (v) => Number(v), 500)
  .option('--reset', 'reabre tudo para reprocessar apos mudar o parser', false)
  .action(async (opts: { limit: number; reset: boolean }) => {
    if (opts.reset) {
      const reopened = await resetParsed()
      logger.info({ reopened }, 'respostas reabertas para reprocessamento')
    }
    const summary = await parsePending(opts.limit)
    logger.info(summary, 'parse concluido')
    process.exitCode = summary.failures > 0 ? 1 : 0
  })

program
  .command('media')
  .description('baixa capas, legendas, slides e videos dos posts ja parseados, nessa ordem')
  .option('--limit <n>', 'quantos arquivos baixar no maximo', (v) => Number(v), 1000)
  .action(async (opts: { limit: number }) => {
    const summary = await downloadPending(opts.limit)
    logger.info(summary, 'download concluido')
  })

program
  .command('transcripts')
  .description('mostra as transcricoes dos reels')
  .option('--post <shortcode>', 'so de um post')
  .option('--out <arquivo>', 'salva em markdown em vez de imprimir (ex: transcricoes.md)')
  .option('--ingest', 'converte os .srt ja baixados (o media ja faz isso sozinho)', false)
  .action(async (opts: { post?: string; out?: string; ingest: boolean }) => {
    if (opts.ingest) {
      logger.info(await ingestSubtitles(), 'transcricoes do instagram')
      return
    }
    if (opts.out) {
      const caminho = await exportTranscripts(opts.out, opts.post)
      console.log(`\nSalvo em ${caminho}\n`)
      return
    }
    await printTranscripts(opts.post)
  })

program
  .command('whisper')
  .description('transcreve os videos baixados com whisper local (roda tambem nos que ja tem legenda do Instagram)')
  .option('--limit <n>', 'quantos videos transcrever', (v) => Number(v), 5)
  .option('--check', 'so verifica se ffmpeg e whisper estao instalados', false)
  .option('--reset', 'apaga as transcricoes locais e refaz', false)
  .action(async (opts: { limit: number; check: boolean; reset: boolean }) => {
    if (opts.reset) logger.info({ apagadas: await resetWhisper() }, 'transcricoes locais apagadas')
    if (opts.check) {
      const t = await checkTools()
      const linha = (nome: string, st: { ok: boolean; motivo?: string }) =>
        console.log(`  ${st.ok ? 'OK   ' : 'FALTA'} ${nome}${st.motivo ? ` — ${st.motivo}` : ''}`)
      console.log()
      linha('ffmpeg', t.ffmpeg)
      linha(`whisper (${t.comando})`, t.whisper)
      console.log()
      process.exitCode = t.ffmpeg.ok && t.whisper.ok ? 0 : 1
      return
    }
    logger.info(await transcribeVideos(opts.limit), 'transcricao local concluida')
  })

program
  .command('enrich')
  .description('analisa os posts com o Claude e grava a extracao estruturada')
  .option('--limit <n>', 'quantos posts analisar', (v) => Number(v), 30)
  .action(async (opts: { limit: number }) => {
    const summary = await enrichPending(opts.limit)
    logger.info(summary, 'enriquecimento concluido')
    process.exitCode = summary.failed > 0 && summary.analyzed === 0 ? 1 : 0
  })

program
  .command('painel')
  .description('abre no navegador o painel local com os dados do banco')
  .option('--port <n>', 'porta do servidor local', (v) => Number(v), 4321)
  .option('--no-open', 'nao abre o navegador sozinho')
  .action(async (opts: { port: number; open: boolean }) => {
    await startPainel(opts.port, opts.open)
  })

program
  .command('db')
  .description('mostra a estrutura do banco, ou roda uma consulta')
  .option('--sql <query>', 'roda esta consulta e imprime o resultado')
  .action(async (opts: { sql?: string }) => {
    if (opts.sql) await runSql(opts.sql)
    else await describeDb()
  })

program
  .command('purge')
  .description('remove do banco tudo que nao veio do Explorar e fecha sessoes interrompidas')
  .action(async () => {
    const summary = await purgeNonExplore()
    logger.info(summary, 'purge concluido')
  })

program
  .command('models')
  .description('lista os modelos disponiveis na sua conta Anthropic')
  .action(async () => {
    for (const model of await listModels()) {
      logger.info({ id: model.id, nome: model.displayName }, 'modelo')
    }
  })

async function countOf(table: typeof post | typeof rawResponse | typeof collectionRun): Promise<number> {
  const rows = await db.select({ n: sql<number>`count(*)` }).from(table)
  return rows[0]?.n ?? 0
}

program
  .command('status')
  .description('mostra orcamento, circuit breaker e totais do banco')
  .action(async () => {
    const fechadas = await closeStaleRuns()
    if (fechadas > 0) logger.warn({ fechadas }, 'sessoes interrompidas foram fechadas')

    const dayKey = localDayKey()
    const budget = await checkBudget()
    const breaker = breakerStatus()

    logger.info(
      {
        dia: dayKey,
        diaDeFolga: isRestDay(dayKey),
        orcamento: budget,
        breaker: {
          aberto: breaker.open,
          ate: breaker.until?.toISOString() ?? null,
          pontos: breaker.points,
          nivel: breaker.level,
        },
        stopFile: isStopRequested(),
        totais: {
          runs: await countOf(collectionRun),
          posts: await countOf(post),
          respostas: await countOf(rawResponse),
        },
      },
      'status',
    )
  })

program
  .command('breaker:reset')
  .description('zera o circuit breaker apos resolver um checkpoint na mao')
  .action(() => {
    resetBreaker()
    logger.info('circuit breaker zerado')
  })

async function main(): Promise<void> {
  try {
    await program.parseAsync(process.argv)
  } catch (error) {
    logger.error({ erro: error instanceof Error ? error.message : String(error) }, 'comando falhou')
    process.exitCode = 1
  } finally {
    closeDb()
  }
}

void main()
