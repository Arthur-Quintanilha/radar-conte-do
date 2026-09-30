import { Command } from 'commander'
import { sql } from 'drizzle-orm'
import { closeDb, db } from '../db/client'
import { collectionRun, post, rawResponse } from '../db/schema'
import { runLogin } from '../session/login'
import { launchContext } from '../session/browser'
import { checkHealth } from '../session/health'
import { runCollection } from '../collector/explore'
import { runAuthorSync } from '../collector/authors'
import { runProbe } from '../collector/probe'
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
import { runSearch } from '../collector/search'
import { loadTerms, pickNext, termStatus } from '../collector/terms'
import { printRanking } from '../inspect/ranking'
import { runWatch } from '../collector/watch'
import { listWatch, marcarConta } from '../collector/watchList'
import { buildPrompt, buildSelecaoPrompt, estimarTokens, selectCandidatas, selectContas, selectPosts } from '../llm/prompt'
import { importarResposta } from '../llm/importar'
import { readFileSync, writeFileSync } from 'node:fs'

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
  .option('--force', 'ignora o circuit breaker', false)
  .option('--limit <n>', 'quantos perfis visitar', (v) => Number(v))
  .action(async (opts: { force: boolean; limit?: number }) => {
    const summary = await runAuthorSync({ force: opts.force, limit: opts.limit })
    process.exitCode = summary.status === 'failed' ? 1 : 0
  })

program
  .command('busca')
  .description('pesquisa um termo no Instagram e rola os resultados; sem termo, pega o proximo de termos.txt')
  .argument('[termo]', 'o que pesquisar, entre aspas se tiver espaco')
  .option('--scrolls <n>', 'quantas vezes rolar os resultados', (v) => Number(v))
  .option('--force', 'ignora o circuit breaker')
  .action(async (termo: string | undefined, opts: { scrolls?: number; force?: boolean }) => {
    const r = await runSearch({ termo, scrolls: opts.scrolls, force: opts.force })
    console.log(`\n  termo:   ${r.termo ?? '-'}`)
    console.log(`  status:  ${r.status}${r.reason ? ` (${r.reason})` : ''}`)
    console.log(`  posts:   ${r.posts} em ${r.paginas} paginas de resultado`)
    if (r.parse) console.log(`  banco:   ${r.parse.postsNew} posts novos, ${r.parse.appearances} aparicoes registradas`)
    if (r.media) console.log(`  midia:   ${r.media.saved} arquivos baixados${r.media.failed ? `, ${r.media.failed} falharam` : ''}`)
    if (r.aviso) console.log(`\n  AVISO: ${r.aviso}`)
    if (r.posts > 0) console.log('\n  Veja com: npm run painel  ou  npm run ranking\n')
    process.exitCode = r.status === 'failed' ? 1 : 0
  })

program
  .command('acompanhar')
  .description('visita os perfis marcados como "acompanhar" e grava os posts deles')
  .option('--usuario <usuario>', 'visita so esta conta')
  .option('--limite <n>', 'quantos perfis visitar nesta execucao', (v) => Number(v))
  .option('--force', 'ignora o circuit breaker')
  .action(async (opts: { usuario?: string; limite?: number; force?: boolean }) => {
    const r = await runWatch({ username: opts.usuario, limite: opts.limite, force: opts.force })
    console.log(`\n  status:    ${r.status}${r.reason ? ` (${r.reason})` : ''}`)
    if (r.visitados.length) console.log(`  visitados: ${r.visitados.map((u) => '@' + u).join(', ')}`)
    console.log(`  posts:     ${r.posts} nas paginas visitadas`)
    if (r.parse) console.log(`  banco:     ${r.parse.postsNew} posts novos, ${r.parse.profileMedias} dos perfis`)
    if (r.media) console.log(`  midia:     ${r.media.saved} arquivos baixados${r.media.failed ? `, ${r.media.failed} falharam` : ''}`)
    if (r.visitados.length) console.log('\n  Veja na aba Acompanhando do painel.\n')
    process.exitCode = r.status === 'failed' ? 1 : 0
  })

program
  .command('marcar')
  .description('marca uma conta: acompanhar, ignorar ou limpar (o mesmo que os botoes do painel)')
  .argument('<usuario>', '@ da conta')
  .argument('<status>', 'acompanhar | ignorar | limpar')
  .action(async (usuario: string, status: string) => {
    if (!['acompanhar', 'ignorar', 'limpar'].includes(status)) {
      console.log('  status deve ser acompanhar, ignorar ou limpar')
      process.exitCode = 1
      return
    }
    const r = await marcarConta(usuario, status === 'limpar' ? null : (status as 'acompanhar' | 'ignorar'))
    const u = `@${usuario.replace(/^@/, '').trim().toLowerCase()}`
    const msg = {
      ok: `  ${u}: ${status}`,
      criada: `  ${u}: acompanhar (conta nova no banco; seguidores, bio e posts chegam na primeira visita do npm run acompanhar)`,
      nao_existe: `  ${u} nao esta no banco`,
      invalida: `  "${usuario}" nao parece um @ do Instagram (so letras, numeros, ponto e _)`,
    }[r]
    console.log(msg)
  })

program
  .command('acompanhando')
  .description('lista as contas marcadas')
  .action(async () => {
    const rows = await listWatch()
    if (!rows.length) console.log('\n  Nenhuma conta marcada. Use a aba Autores do painel ou npm run marcar.\n')
    for (const r of rows) {
      const quando = r.lastWatchedAt ? r.lastWatchedAt.toLocaleString('pt-BR') : 'nunca visitada'
      console.log(`  ${(r.watch ?? '').padEnd(10)} ${r.watchSource === 'ia' ? '(IA) ' : '     '}@${r.username.padEnd(28)} ${r.watch === 'acompanhar' ? quando : ''}`)
    }
  })

program
  .command('prompt')
  .description('gera o prompt de classificacao (o mesmo da aba IA do painel) para levar a uma LLM')
  .argument('<tipo>', 'contas | posts | selecao (quem acompanhar)')
  .option('--limite <n>', 'quantos itens no lote', (v) => Number(v), 30)
  .option('--vagas <n>', 'na selecao: quantas contas a IA pode acompanhar', (v) => Number(v), 15)
  .option('--refazer', 'inclui itens ja classificados', false)
  .option('--saida <arquivo>', 'grava num arquivo em vez de imprimir')
  .action((tipo: string, opts: { limite: number; vagas: number; refazer: boolean; saida?: string }) => {
    if (tipo === 'selecao') {
      const { candidatas, fixas } = selectCandidatas()
      if (!candidatas.length) {
        console.log('  Nenhuma candidata: avalie contas primeiro (a IA marca quem vale acompanhar).')
        return
      }
      const prompt = buildSelecaoPrompt(opts.vagas, candidatas, fixas)
      if (opts.saida) {
        writeFileSync(opts.saida, prompt, 'utf8')
        console.log(`  ${candidatas.length} candidatas para ${opts.vagas} vagas em ${opts.saida} (~${estimarTokens(prompt)} tokens)`)
      } else console.log(prompt)
      return
    }
    const t = tipo === 'posts' ? 'posts' : 'contas'
    const { itens } = t === 'contas' ? selectContas(opts.limite, opts.refazer) : selectPosts(opts.limite, opts.refazer)
    if (!itens.length) {
      console.log(`  Nada para classificar em ${t}.`)
      return
    }
    const prompt = buildPrompt(t, itens)
    if (opts.saida) {
      writeFileSync(opts.saida, prompt, 'utf8')
      console.log(`  ${itens.length} ${t} em ${opts.saida} (~${estimarTokens(prompt)} tokens)`)
    } else {
      console.log(prompt)
    }
  })

program
  .command('importar')
  .description('grava no banco a resposta que a LLM devolveu (arquivo com o bloco ```json)')
  .argument('<arquivo>', 'arquivo com a resposta colada')
  .option('--modelo <nome>', 'qual LLM respondeu', 'manual')
  .action(async (arquivo: string, opts: { modelo: string }) => {
    const r = await importarResposta(readFileSync(arquivo, 'utf8'), opts.modelo)
    console.log(`\n  ${r.tipo ?? '?'}: ${r.gravados} gravados`)
    if (r.removidos?.length) console.log(`  sairam do acompanhamento: ${r.removidos.join(', ')}`)
    if (r.desconhecidos.length) console.log(`  ids que nao estao no banco: ${r.desconhecidos.join(', ')}`)
    for (const i of r.invalidos) console.log(`  invalido ${i.id}: ${i.erro}`)
    console.log('')
  })

program
  .command('termos')
  .description('mostra a fila de termos de busca e quando cada um foi pesquisado')
  .action(async () => {
    const status = await termStatus(loadTerms())
    const proximo = pickNext(status)
    if (status.length === 0) console.log('\n  termos.txt vazio ou inexistente.\n')
    for (const t of status) {
      const quando = t.ultima ? t.ultima.toLocaleString('pt-BR') : 'nunca'
      console.log(`  ${t.termo === proximo ? '→' : ' '} ${t.termo.padEnd(30)} ${String(t.buscas).padStart(3)}x  ${quando}`)
    }
    console.log('')
  })

program
  .command('ranking')
  .description('ranking dos posts e autores achados nas buscas')
  .option('--termo <termo>', 'so um termo')
  .option('--limite <n>', 'quantas linhas por tabela', (v) => Number(v), 25)
  .option('--idioma <lang>', 'todos (padrao), pt, en, es ou id', 'todos')
  .action(async (opts: { termo?: string; limite: number; idioma: string }) => {
    await printRanking({ termo: opts.termo, limite: opts.limite, idioma: opts.idioma })
  })

program
  .command('sonda')
  .description('busca um termo no Instagram e so grava o bruto, para estudar o formato da busca')
  .argument('<termo>', 'o que digitar na busca, entre aspas se tiver espaco')
  .option('--scrolls <n>', 'quantas vezes rolar os resultados', (v) => Number(v), 3)
  .action(async (termo: string, opts: { scrolls: number }) => {
    const r = await runProbe(termo, opts.scrolls)
    console.log(`\n  termo:      ${r.termo}`)
    console.log(`  pagina:     ${r.urlFinal ?? '-'}`)
    console.log(`  respostas:  ${r.respostas}   posts distintos vistos: ${r.midias}`)
    if (r.porEndpoint.length) {
      console.log('\n  endpoints:')
      for (const e of r.porEndpoint) {
        console.log(`    ${String(e.vezes).padStart(3)}x  ${e.tipo.padEnd(12)} ${String(e.kb).padStart(5)} KB  ${String(e.midias).padStart(3)} midias  ${e.endpoint}`)
      }
    }
    console.log(`\n  no HTML:    ${r.htmlShortcodes} shortcodes; ${r.htmlBlocos.blocos} blocos JSON, ${r.htmlBlocos.comMidia} com midia (${r.htmlBlocos.midias} midias)`)
    console.log(`  requisicoes registradas: ${r.requisicoes}`)
    if (r.screenshot) console.log(`\n  print da tela: ${r.screenshot}`)
    for (const h of r.html) console.log(`  html:          ${h}`)
    if (r.rede) console.log(`  rede:          ${r.rede}`)
    if (r.erro) console.log(`\n  ERRO: ${r.erro}`)
    console.log('\n  Nada foi transformado em post. Me avise que eu leio o bruto.\n')
    process.exitCode = r.erro ? 1 : 0
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
  .description('remove do banco tudo que nao veio do Explorar nem da busca e fecha sessoes interrompidas')
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
