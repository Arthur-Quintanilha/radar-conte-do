import { Command } from 'commander'
import { sql } from 'drizzle-orm'
import { closeDb, db } from '../db/client'
import { collectionRun, post, rawResponse } from '../db/schema'
import { runLogin } from '../session/login'
import { launchContext } from '../session/browser'
import { checkHealth } from '../session/health'
import { parsePending, resetParsed } from '../parser/run'
import { downloadPending } from '../enricher/download'
import { ingestSubtitles } from '../enricher/transcript'
import { checkTools, resetWhisper, transcribeVideos } from '../enricher/whisper'
import { listModels } from '../enricher/anthropic'
import { personaAtiva } from '../creator/persona'
import { config } from '../shared/config'
import { contasDaPersona } from '../creator/grafo'
import { referenciasAtivas } from '../creator/referencias'
import { describeDb, runSql } from '../inspect/db'
import { exportTranscripts, printTranscripts } from '../inspect/transcripts'
import { startPainel } from '../painel/server'
import { closeStaleRuns } from '../maintenance/purge'
import { migrarSqlite } from '../maintenance/migrarSqlite'
import { breakerStatus, resetBreaker } from '../collector/breaker'
import { checkBudget, isRestDay } from '../shared/budget'
import { localDayKey } from '../shared/time'
import { isStopRequested } from '../shared/stop'
import { logger } from '../shared/logger'
import { registrarComandos } from '../creator/cli'

const program = new Command()

program.name('radar').description('Radar de conteúdo: pauta e roteiro para creators a partir do que o público consome').version('0.1.0')

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
  .command('parse')
  .description('processa as respostas brutas ainda nao parseadas')
  .option('--limit <n>', 'quantas respostas processar', (v) => Number(v), 500)
  .option('--reset', 'reabre tudo para reprocessar apos mudar o parser', false)
  .option('--kind <tipo>', 'reabre so as respostas deste tipo (ex.: following) e reprocessa')
  .action(async (opts: { limit: number; reset: boolean; kind?: string }) => {
    if (opts.kind) {
      const reabertas = await db.update(rawResponse).set({ parsedAt: null }).where(sql`${rawResponse.endpointKind} = ${opts.kind}`).returning({ id: rawResponse.id })
      logger.info({ reabertas: reabertas.length, tipo: opts.kind }, 'respostas reabertas')
    }
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
  .option('--limit <n>', 'quantos videos transcrever', (v) => Number(v), 30)
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
    // os reels da persona ativa (dentro da janela) vao primeiro; depois o resto, do mais novo
    const p = await personaAtiva()
    const fila = p ? { autores: await contasDaPersona(p.id, await referenciasAtivas(p.id)), desdeDias: config.JANELA_DIAS } : {}
    logger.info(await transcribeVideos(opts.limit, fila), 'transcricao local concluida')
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
  .command('migrar-sqlite')
  .description('copia o banco SQLite antigo (DB_FILE) para o Postgres da DATABASE_URL')
  .option('--arquivo <caminho>', 'outro arquivo .db')
  .option('--com-brutos', 'copia tambem os corpos das respostas brutas (~350 MB)', false)
  .option('--limpar', 'apaga o que ja existe no Postgres antes de copiar', false)
  .action(async (opts: { arquivo?: string; comBrutos: boolean; limpar: boolean }) => {
    console.log('\n  Copiando o SQLite para o Postgres...\n')
    const r = await migrarSqlite(opts)
    const faltou = r.filter((x) => x.postgres < x.sqlite)
    console.log(faltou.length ? `\n  Atenção: ${faltou.map((x) => x.tabela).join(', ')} ficaram com menos linhas que no SQLite.\n` : '\n  Pronto: tudo copiado.\n')
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

registrarComandos(program)

async function main(): Promise<void> {
  try {
    await program.parseAsync(process.argv)
  } catch (error) {
    logger.error({ erro: error instanceof Error ? error.message : String(error) }, 'comando falhou')
    process.exitCode = 1
  } finally {
    await closeDb()
  }
}

void main()
