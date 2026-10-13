import { existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Command } from 'commander'
import { runSeguindo } from '../collector/following'
import { config } from '../shared/config'
import { atualizarGrafo } from './grafo'
import { gerarPauta, montarPauta, aplicarPauta, semanaDe } from './pauta'
import { adicionarSementes, ativarPersona, criarPersona, exigirPersona, listarPersonas, listarSementes, normalizarUsername } from './persona'
import { aplicar, montarContas, montarEncaixe, montarTerritorio, rodarTarefa } from './tarefas'
import { ETAPAS, runSemana, type Etapa } from './semana'
import { writeFileSync } from 'node:fs'
import { closeDb } from '../db/client'
import { rodarConta } from './conta'
import { apagarRoteiros, gerarRoteiro, montarRoteiro, textoRoteiro } from './roteiro'
import { adicionarReferencias, listarReferencias, setStatusReferencia } from './referencias'

/** Comandos da tese creator. Registrados no mesmo `ig-insights` do resto. */
export function registrarComandos(program: Command): void {
  const persona = program.command('persona').description('personas (creators): listar, criar, ativar')
  persona
    .command('listar', { isDefault: true })
    .description('lista as personas; a ativa vem marcada')
    .action(async () => {
      const ps = await listarPersonas()
      if (!ps.length) console.log('\n  Nenhuma persona. Crie com: npm run persona -- criar "Lucas"\n')
      for (const p of ps) console.log(`  ${p.ativa ? '●' : ' '} ${p.nome.padEnd(24)} ${p.handle ? '@' + p.handle : ''}  ${p.territorio ? 'território v' + p.territorioVersao : 'sem território'}  ${p.id}`)
    })
  persona
    .command('criar')
    .argument('<nome>')
    .option('--handle <@>', '@ do Instagram do proprio creator')
    .action(async (nome: string, opts: { handle?: string }) => {
      const p = await criarPersona(nome, opts.handle)
      console.log(`\n  ${p.nome} criada${p.ativa ? ' e ativa' : ''}. Responda a entrevista na aba Creator do painel.\n`)
    })
  persona
    .command('ativar')
    .argument('<nome-ou-id>')
    .action(async (alvo: string) => {
      const ps = await listarPersonas()
      const p = ps.find((x) => x.id === alvo || x.nome.toLowerCase() === alvo.toLowerCase())
      if (!p) throw new Error(`nao achei a persona "${alvo}"`)
      await ativarPersona(p.id)
      console.log(`\n  ${p.nome} agora e a persona ativa.\n`)
    })

  program
    .command('sementes')
    .description('lista as sementes da persona ativa, ou adiciona (@, nome ou link do perfil)')
    .argument('[contas...]', 'contas para adicionar')
    .action(async (contas: string[]) => {
      const p = await exigirPersona()
      if (contas.length) {
        const r = await adicionarSementes(p.id, contas)
        console.log(`\n  adicionadas: ${r.adicionadas.map((u) => '@' + u).join(', ') || '-'}`)
        if (r.jaExistiam.length) console.log(`  ja existiam: ${r.jaExistiam.join(', ')}`)
        if (r.invalidas.length) console.log(`  invalidas:   ${r.invalidas.join(', ')}`)
        console.log('')
        return
      }
      for (const s of await listarSementes(p.id)) {
        const quando = s.coletadaEm ? s.coletadaEm.toLocaleDateString('pt-BR') : 'nunca'
        console.log(`  ${s.status.padEnd(11)} @${s.username.padEnd(28)} lista: ${quando}${s.erro ? `  (${s.erro})` : ''}`)
      }
    })

  program
    .command('referencias')
    .description('lista as referencias de conteudo da persona ativa, ou adiciona (@, nome ou link)')
    .argument('[contas...]', 'contas para adicionar')
    .option('--sugestoes', 'importa docs/referencias-sugeridas.txt como "sugerida"', false)
    .action(async (contas: string[], opts: { sugestoes: boolean }) => {
      const p = await exigirPersona()
      if (opts.sugestoes) {
        const linhas = readFileSync(resolve(process.cwd(), 'docs', 'referencias-sugeridas.txt'), 'utf8').split('\n').filter((l) => l.trim() && !l.startsWith('#'))
        // sugestao antiga que saiu do arquivo e ninguem ativou: sai do painel
        const noArquivo = new Set(linhas.map((l) => normalizarUsername(l.split('|')[0] ?? '')))
        for (const r of await listarReferencias(p.id)) {
          if (r.status === 'sugerida' && r.origem === 'sugestao' && !noArquivo.has(r.username)) {
            await setStatusReferencia(p.id, r.username, 'remover')
            console.log(`  removida  @${r.username}`)
          }
        }
        for (const l of linhas) {
          const [conta, motivo] = l.split('|').map((x) => x.trim())
          if (!conta) continue
          const r = await adicionarReferencias(p.id, [conta], { status: 'sugerida', origem: 'sugestao', motivo: motivo ?? null })
          console.log(`  ${r.adicionadas.length ? 'sugerida ' : 'ja existe'} ${conta}`)
        }
        console.log('\n  Confira cada perfil e ative na aba Sementes.\n')
        return
      }
      if (contas.length) {
        const r = await adicionarReferencias(p.id, contas)
        console.log(`\n  adicionadas: ${r.adicionadas.map((u) => '@' + u).join(', ') || '-'}${r.invalidas.length ? `\n  invalidas: ${r.invalidas.join(', ')}` : ''}\n`)
        return
      }
      for (const r of await listarReferencias(p.id)) console.log(`  ${r.status.padEnd(9)} @${r.username.padEnd(28)} ${r.motivo ?? ''}`)
    })

  program
    .command('seguindo')
    .description('abre o perfil de cada semente e coleta a lista de quem ela segue')
    .option('--usuario <@>', 'so esta semente')
    .option('--limite <n>', 'quantas sementes nesta sessao', (v) => Number(v))
    .option('--force', 'ignora orcamento e circuit breaker')
    .action(async (opts: { usuario?: string; limite?: number; force?: boolean }) => {
      // sessoes de SEGUINDO_POR_SESSAO sementes, uma atras da outra, ate a fila acabar
      for (let sessao = 1; sessao <= 10; sessao++) {
        const r = await runSeguindo({ username: opts.usuario, limite: opts.limite, force: opts.force })
        console.log(`\n  sessao ${sessao}: ${r.status}${r.reason ? ` (${r.reason})` : ''}`)
        for (const s of r.sementes) console.log(`  @${s.semente.padEnd(28)} ${String(s.contas).padStart(4)} contas${s.erro ? `  (${s.erro})` : ''}`)
        if (r.parse) console.log(`  arestas gravadas: ${r.parse.arestas}`)
        if (r.status === 'failed') process.exitCode = 1
        if (r.status !== 'ok' || opts.usuario || r.sementes.length === 0) break
      }
      console.log('')
    })

  program
    .command('grafo')
    .description('recalcula quem as sementes seguem em comum e marca essas contas para acompanhar')
    .action(async () => {
      const g = await atualizarGrafo()
      console.log(g.reason ? `\n  ${g.reason}\n` : `\n  ${g.sementes} sementes, minimo ${g.minimo} em comum: ${g.contas} contas; ${g.acompanhadas} acompanhadas, ${g.liberadas} liberadas\n`)
    })

  program
    .command('ia')
    .description('roda uma tarefa de IA pela API: territorio | contas | encaixe | pauta')
    .argument('<tarefa>')
    .option('--refazer', 'refaz o que ja foi avaliado (so um lote) / troca as ideias da pauta ainda sem resposta', false)
    .option('--prompt <arquivo>', 'nao chama a API: grava o prompt num arquivo para colar numa conversa')
    .option('--resposta <arquivo>', 'nao chama a API: aplica a resposta colada deste arquivo')
    .option('--minimo <n>', 'pauta: minimo de ideias (sem isto, a IA decide quantas)')
    .action(async (tarefa: string, opts: { refazer: boolean; prompt?: string; resposta?: string; minimo?: string }) => {
      if (!['territorio', 'contas', 'encaixe', 'pauta'].includes(tarefa)) throw new Error('tarefa: territorio | contas | encaixe | pauta')
      const p = await exigirPersona()
      if (opts.prompt) {
        const m =
          tarefa === 'territorio' ? montarTerritorio(p) : tarefa === 'contas' ? await montarContas(p) : tarefa === 'encaixe' ? await montarEncaixe(p) : await montarPauta(p)
        if (!m.itens) console.log(`\n  nada a fazer: ${m.motivo}\n`)
        else {
          writeFileSync(opts.prompt, m.prompt, 'utf8')
          console.log(`\n  ${m.itens} itens em ${opts.prompt}\n`)
        }
        return
      }
      if (opts.resposta) {
        const texto = readFileSync(opts.resposta, 'utf8')
        const a = tarefa === 'pauta' ? await aplicarPauta(p, texto, 'manual') : await aplicar(tarefa as 'territorio' | 'contas' | 'encaixe', p, texto, 'manual')
        console.log(`\n  ${a.gravados} gravados${a.invalidos.length ? `, ${a.invalidos.length} invalidos` : ''}${a.desconhecidos.length ? `, ids desconhecidos: ${a.desconhecidos.join(', ')}` : ''}\n`)
        return
      }
      if (tarefa === 'pauta') {
        const r = await gerarPauta({ refazer: opts.refazer, minimo: opts.minimo ? Number(opts.minimo) : null })
        console.log(`\n  ${r.motivo ?? `+${r.ideias} ideias na pauta de ${r.semana}; ${r.radar} temas no radar`}\n`)
        return
      }
      const r = await rodarTarefa(tarefa as 'territorio' | 'contas' | 'encaixe', { refazer: opts.refazer })
      console.log(`\n  ${r.motivo ?? `${r.gravados} gravados em ${r.lotes} lotes`}${r.extra ? ` ${JSON.stringify(r.extra)}` : ''}\n`)
    })

  program
    .command('semana')
    .description(`o ciclo semanal inteiro da persona ativa: ${ETAPAS.join(' -> ')}`)
    .option('--sem-coleta', 'pula as etapas que abrem o navegador', false)
    .option('--etapas <lista>', `so estas, separadas por virgula (${ETAPAS.join(',')})`)
    .option('--refazer-pauta', 'gera a pauta de novo mesmo se ja existir', false)
    .option('--force', 'ignora orcamento e circuit breaker nas coletas', false)
    .option('--minimo <n>', 'minimo de ideias na pauta (sem isto, a IA decide quantas)')
    .action(async (opts: { semColeta: boolean; etapas?: string; refazerPauta: boolean; force: boolean; minimo?: string }) => {
      const etapas = opts.etapas?.split(',').map((e) => e.trim()).filter(Boolean) as Etapa[] | undefined
      const invalidas = etapas?.filter((e) => !(ETAPAS as readonly string[]).includes(e)) ?? []
      if (invalidas.length) throw new Error(`etapas desconhecidas: ${invalidas.join(', ')}`)
      const r = await runSemana({ etapas, semColeta: opts.semColeta, refazerPauta: opts.refazerPauta, force: opts.force, minimo: opts.minimo ? Number(opts.minimo) : null })
      process.exitCode = r.ok ? 0 : 1
    })

  program
    .command('arquivar')
    .description('move o SQLite antigo, os brutos e as midias para data/archive/<data> (o Postgres nao e tocado)')
    .action(async () => {
      await closeDb()
      const destino = resolve(process.cwd(), 'data', 'archive', new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-'))
      mkdirSync(destino, { recursive: true })
      const db = resolve(process.cwd(), config.DB_FILE)
      const alvos = [db, `${db}-wal`, `${db}-shm`, resolve(process.cwd(), config.RAW_DIR), resolve(process.cwd(), config.MEDIA_DIR), resolve(process.cwd(), 'data', 'export')]
      for (const a of alvos) {
        if (!existsSync(a)) continue
        try {
          renameSync(a, join(destino, a.split(/[\\/]/).pop() ?? 'x'))
          console.log(`  movido: ${a}`)
        } catch (error) {
          console.log(`  NAO consegui mover ${a}: ${(error as Error).message}. O painel ou outro comando esta aberto?`)
          process.exitCode = 1
          return
        }
      }
      console.log(`\n  Arquivado em ${destino}\n  O banco Postgres continua como estava; para zerar, apague as tabelas no Supabase e rode npm run db:migrate.\n`)
    })

  program
    .command('conta')
    .description('roda uma etapa so para uma conta: visitar | transcrever | classificar | avaliar | seguindo | atualizar')
    .argument('<usuario>')
    .argument('<acao>')
    .action(async (usuario: string, acao: string) => {
      const r = await rodarConta(usuario, acao)
      for (const l of r) console.log(`  ${l}`)
      console.log('')
    })

  program
    .command('roteiro')
    .description('gera o roteiro de uma ideia da pauta pelo id da ideia')
    .argument('<ideia>')
    .option('--resposta <texto>', 'sua resposta a "Pergunta para..." do angulo')
    .option('--pedido <texto>', 'ajuste em cima da ultima versao (ex.: "mais curto")')
    .option('--prompt', 'so imprime o prompt, sem chamar a API', false)
    .option('--apagar', 'apaga todas as versoes do roteiro desta ideia', false)
    .action(async (id: string, opts: { resposta?: string; pedido?: string; prompt: boolean; apagar: boolean }) => {
      if (opts.apagar) {
        console.log(`\n  ${await apagarRoteiros(id)} versoes apagadas\n`)
        return
      }
      if (opts.prompt) {
        console.log((await montarRoteiro(id, { ...opts, comImagens: false })).prompt)
        return
      }
      const r = await gerarRoteiro(id, opts)
      console.log(`\n  Roteiro v${r.versao} (${r.modelo})\n\n${textoRoteiro(r.conteudo)}\n`)
    })

  program
    .command('semana-atual')
    .description('mostra a chave da semana atual (ex.: 2026-W40)')
    .action(() => console.log(semanaDe()))
}
