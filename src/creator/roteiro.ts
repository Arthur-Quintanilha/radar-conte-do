import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { and, eq, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { ideia, roteiro } from '../db/schema'
import { extrairJson } from '../llm/importar'
import { corta, territorioTexto } from './dados'
import { perguntarLlm, modeloPauta, temApi } from './llm'
import { detalheIdeia, type PostDetalhe } from './painel'
import { quadrosDoPost, type Imagem } from '../enricher/quadros'
import { exigirPersona, territorioDe } from './persona'
import { PERGUNTAS, roteiroAnswer, type RoteiroAnswer } from './tipos'

/**
 * Roteiro de uma ideia da pauta: o que o creator fala, bloco a bloco, no
 * jeito dele. A materia-prima e a ideia, o post de referencia (legenda e
 * transcricao), o formato sugerido, o territorio e, principalmente, a
 * resposta dele a "Pergunta para...": e dali que sai a historia verdadeira.
 */

export interface RoteiroRow {
  id: string
  ideiaId: string
  versao: number
  resposta: string | null
  pedido: string | null
  conteudo: RoteiroAnswer
  texto: string | null
  status: string
  modelo: string | null
  createdAt: number
}

export interface OpcoesRoteiro {
  /** resposta do creator a pergunta do angulo; sem ela, reaproveita a da versao anterior */
  resposta?: string
  /** ajuste em cima da ultima versao: "mais curto", "menos formal"... */
  pedido?: string
}

/** A pergunta que a pauta deixou para o creator, se houver. */
export function perguntaDoAngulo(angulo: string | null | undefined): string | null {
  const m = /Pergunta para [^:\n]{1,40}:\s*([\s\S]+)$/i.exec(angulo ?? '')
  return m ? m[1]!.trim() : null
}

/** Tipo de peca, a partir do formato livre que a pauta escreveu. */
export function tipoDePeca(formato: string | null | undefined): 'reels' | 'carrossel' | 'foto' | 'stories' {
  const f = (formato ?? '').toLowerCase()
  if (f.includes('carrossel') || f.includes('carousel')) return 'carrossel'
  if (f.includes('stories') || f.includes('story')) return 'stories'
  if (f.includes('foto')) return 'foto'
  return 'reels'
}

const textoGancho = (g: unknown): { texto: string; entonacao: string } =>
  g && typeof g === 'object' ? { texto: String((g as { texto?: unknown }).texto ?? ''), entonacao: String((g as { entonacao?: unknown }).entonacao ?? '') } : { texto: String(g ?? ''), entonacao: '' }

/** So a fala, para ler no teleprompter. */
export function textoParaLer(c: RoteiroAnswer): string {
  return c.fala.trim()
}

/** O roteiro em texto corrido: para copiar e mandar de volta num ajuste. */
export function textoRoteiro(c: RoteiroAnswer): string {
  const partes: string[] = []
  if (c.molde) partes.push(`FORMATO${c.formato_de ? ` (copiado de @${c.formato_de})` : ''}`, c.molde, '')
  if (c.gravacao) partes.push(`COMO GRAVAR (sugestão): ${c.gravacao}`, '')
  const audio = [c.audio?.tipo, c.audio?.nome].filter(Boolean).join(': ')
  if (audio || c.audio?.nota) partes.push(`ÁUDIO: ${audio}${c.audio?.nota ? ` — ${c.audio.nota}` : ''}`, '')
  partes.push(`ROTEIRO${c.formato ? ` · ${c.formato}` : ''}${c.duracao_s ? ` · ~${Math.round(c.duracao_s)}s` : ''}`)
  if (c.tom) partes.push(`(${c.tom})`)
  partes.push('', c.fala.trim())
  if (c.tela.length) partes.push('', 'TEXTO NA TELA', ...c.tela.map((t) => `- ${t}`))
  const outras = c.ganchos.map(textoGancho).slice(1)
  if (outras.length) partes.push('', 'OUTRAS ABERTURAS', ...outras.map((g) => `- ${g.texto}`))
  partes.push('', 'LEGENDA', c.legenda || '—')
  if (c.lembretes.length) partes.push('', 'DICAS PARA GRAVAR', ...c.lembretes.map((l) => `- ${l}`))
  return partes.join('\n')
}

export function listarRoteiros(ideiaId: string): RoteiroRow[] {
  const rows = db.all<Omit<RoteiroRow, 'conteudo'> & { conteudo: string }>(sql`
    select id, ideia_id as ideiaId, versao, resposta, pedido, conteudo, texto, status, modelo, created_at as createdAt
    from roteiro where ideia_id = ${ideiaId} order by versao desc
  `)
  return rows.flatMap((r) => {
    const c = roteiroAnswer.safeParse(JSON.parse(r.conteudo || '{}'))
    return c.success ? [{ ...r, conteudo: c.data }] : []
  })
}

const GUIA_PECA: Record<ReturnType<typeof tipoDePeca>, string> = {
  reels: `É um Reels falado. Mire 30 a 60 segundos a umas 2,5 palavras por segundo: a fala inteira tem que caber no tempo.`,
  carrossel: `É um carrossel: em "fala", um parágrafo por slide (título forte + no máximo 2 ou 3 linhas). 6 a 9 slides. O slide 1 é o gancho; o último fecha com a chamada final.`,
  foto: `É uma foto com legenda. O peso está na "legenda", que aqui é o conteúdo inteiro: abra com o gancho, conte a história em parágrafos curtos e feche com a chamada. "fala" = o texto sobre a foto, se houver, ou a própria legenda.`,
  stories: `É uma sequência de stories: em "fala", um parágrafo por story (até ~15s cada). 4 a 7 stories.`,
}

const TIPO_PECA: Record<string, ReturnType<typeof tipoDePeca>> = { reel: 'reels', video: 'reels', clips: 'reels', carousel: 'carrossel', image: 'foto' }

const palavras = (t: string | null | undefined): number => (t ?? '').split(/\s+/).filter(Boolean).length

/** O post cujo formato o roteiro copia: o formato sugerido, ou o proprio post do assunto quando ele rendeu. */
export function postDoFormato(assunto: PostDetalhe | null, formatoRef: PostDetalhe | null): PostDetalhe | null {
  if (formatoRef) return formatoRef
  if (assunto && (assunto.desempenho === null || assunto.desempenho >= 1)) return assunto
  return null
}

function blocoFormato(f: PostDetalhe, duracao: number | null, comQuadros: number, mesmoPost: boolean, nome: string): string {
  const fala = f.transcricoes[0]?.texto ?? null
  const ritmo = fala && duracao ? (palavras(fala) / duracao).toFixed(1).replace('.', ',') : null
  const musica = f.audio && !/original/i.test(f.audio) ? f.audio : null
  const sinal = [
    f.likes !== null ? `${f.likes.toLocaleString('pt-BR')} curtidas` : null,
    f.comments !== null ? `${f.comments.toLocaleString('pt-BR')} comentários` : null,
    f.desempenho !== null ? `${f.desempenho.toFixed(1).replace('.', ',')}x o normal do autor` : null,
  ].filter(Boolean).join(', ')
  const dados = [
    `- Autor: @${f.autor}${f.autorNome ? ` (${f.autorNome})` : ''}${sinal ? ` — ${sinal}` : ''}`,
    `- Tipo: ${f.tipo ?? '?'}${f.slides > 1 ? `, ${f.slides} slides` : ''}`,
    duracao ? `- Duração real: ${Math.round(duracao)}s` : null,
    fala ? `- Fala: ${palavras(fala)} palavras${ritmo ? ` (${ritmo} palavras por segundo)` : ''}` : f.semFala ? '- Sem fala: só música ou silêncio; o conteúdo está no texto na tela' : null,
    f.audio ? `- Áudio: ${f.audio}${musica ? ' (música/trend: o roteiro usa o MESMO áudio, no mesmo ritmo)' : ''}` : null,
    f.features?.gancho ? `- Tipo de gancho: ${f.features.gancho}` : null,
    f.features?.cta && f.features.cta !== 'nenhum' ? `- Chamada final: ${f.features.cta}` : null,
  ].filter(Boolean).join('\n')
  return `## O FORMATO A COPIAR — a parte mais importante

${mesmoPost ? `Este é o próprio post de onde veio o assunto, e o formato dele funcionou.` : `Este post é a referência de FORMATO (o assunto vem de outro post, mais abaixo).`} O que fez esse post engajar foi o formato: a estrutura da fala, o ritmo, a entonação, o jeito de abrir e de fechar e o áudio. O roteiro de ${nome} é o MESMO post, no mesmo formato, com o conteúdo e a voz de ${nome}.

${dados}
${comQuadros ? `\nAs ${comQuadros} imagens antes deste texto são quadros desse post, em ordem (cada uma com o momento ou slide): use para ler o ritmo, a energia e a expressão de quem fala, o texto na tela e se há alguma ação que faz parte do formato (andar, gesto da trend). Não copie o cenário.\n` : ''}
**Legenda:**
${corta(f.legenda, 1_500) || '(sem legenda)'}

**Transcrição completa da fala:**
${fala ? corta(fala, 4_000) : '(sem fala transcrita)'}${f.alt ? `\n\n**Descrição automática da imagem:** ${corta(f.alt, 300)}` : ''}`
}

function blocoAssunto(a: PostDetalhe): string {
  const fala = a.transcricoes[0]?.texto ?? null
  return `## Post de onde vem o ASSUNTO

Use o assunto e os fatos que ele traz. A forma deste post não interessa: o formato é o da seção acima.

- Autor: @${a.autor}${a.autorNome ? ` (${a.autorNome})` : ''}

**Legenda:**
${corta(a.legenda, 1_500) || '(sem legenda)'}

**Fala:**
${fala ? corta(fala, 3_000) : '(sem fala transcrita)'}`
}

export interface MontagemRoteiro {
  prompt: string
  resposta: string | null
  pedido: string | null
  imagens: Imagem[]
  /** @ do post cujo formato foi copiado */
  formatoDe: string | null
}

export async function montarRoteiro(ideiaId: string, opts: OpcoesRoteiro & { comImagens?: boolean } = {}): Promise<MontagemRoteiro> {
  const i = await detalheIdeia(ideiaId)
  if (!i) throw new Error('ideia não encontrada')
  if (i.tipo !== 'pauta') throw new Error('roteiro é só para ideias da pauta')
  const p = await exigirPersona(i.personaId)
  const t = territorioDe(p)
  if (!t) throw new Error('a persona ainda não tem território')

  const anteriores = listarRoteiros(ideiaId)
  const ultimo = anteriores[0] ?? null
  const resposta = (opts.resposta ?? '').trim() || ultimo?.resposta || null
  const pedido = (opts.pedido ?? '').trim() || null
  const pergunta = perguntaDoAngulo(i.angulo)
  const publico = t.publico || p.publico || '(não informado)'

  const fmt = postDoFormato(i.assunto, i.formatoRef)
  const mesmoPost = Boolean(fmt && fmt === i.assunto)
  let imagens: Imagem[] = []
  let duracao = fmt?.duracao ?? null
  if (fmt) {
    try {
      const q = await quadrosDoPost(fmt.shortcode, opts.comImagens === false ? 0 : 6)
      if (opts.comImagens !== false) imagens = q.imagens
      duracao = duracao ?? q.duracao
    } catch {
      // sem ffmpeg ou sem midia: segue so com o texto
    }
  }
  // sem post de formato provado: o formato da ideia so vale se ainda estiver entre os do creator
  // (ex.: a pauta sugeriu stories quando "stories" estava marcado e depois foi desmarcado)
  const permitidas = new Set((t.formatos ?? []).map((f) => tipoDePeca(f)))
  const daIdeia = tipoDePeca(i.formato)
  const ideiaValida = !permitidas.size || permitidas.has(daIdeia)
  const peca = (fmt?.tipo && TIPO_PECA[fmt.tipo]) || (ideiaValida ? daIdeia : (i.assunto?.tipo && TIPO_PECA[i.assunto.tipo]) || [...permitidas][0] || 'reels')
  const formatoIdeia = ideiaValida ? i.formato : null

  const entrevista = PERGUNTAS.filter((q) => q.chave !== 'fora' && (p.entrevista[q.chave] ?? '').trim())
    .map((q) => `**${q.pergunta}**\n${corta(p.entrevista[q.chave]!.trim(), 1_200)}`)
    .join('\n\n')

  const regrasFormato = fmt
    ? `- FORMATO PRIMEIRO. Antes do roteiro, escreva em "molde" o esqueleto da FALA do post de referência: a sequência do que é dito, o padrão que se repete (ex.: "Um ___ para quem ___: [nome]. [uma frase do porquê]", repetido N vezes), quantos itens, o ritmo (rápido, pausado, lista corrida), o tom, como abre, como fecha e o áudio. Cenário, roupa e luz não entram: isso é do creator.
- Depois escreva a fala seguindo esse molde: mesmo número de itens, a mesma frase-moldura repetida (pode usar as mesmas palavras da moldura: é isso que torna o formato reconhecível), a mesma duração (±15%, a umas 2,5 palavras por segundo), o mesmo ritmo, o mesmo tipo de abertura e o mesmo áudio. Se o fechamento pede para comentar uma palavra em troca de algo, faça igual só se ${p.nome} tiver algo real a oferecer; senão, troque por uma pergunta no mesmo lugar.
- Não "melhore" o formato: não acrescente nem tire partes, não troque a estrutura por outra que você ache melhor. O formato provado vence o seu gosto. O formato escrito na ideia é só um resumo; se divergir do post, vale o post.
- O que muda é o CONTEÚDO: os itens, exemplos e opiniões são escolhas de ${p.nome}, no nível do público dele. Não repita os mesmos itens do autor um a um; quando não souber os dele, escolha outros igualmente bons e conhecidos.`
    : `- ${GUIA_PECA[peca]}`

  const prompt = `# Tarefa (creator · roteiro)

Escreva o roteiro de um post do Instagram pessoal de ${p.nome}. É o texto que ele vai FALAR (ou escrever, se for carrossel/foto), em primeira pessoa, no jeito dele. O objetivo é que alguém do público dele assista até o fim e saia achando ${p.nome} alguém que entende do problema dele — não vender nada.

**Público:** ${publico}

## A ideia

- Título: ${i.titulo}
- Gancho sugerido: ${i.hook || '(nenhum)'}
- Ângulo: ${i.angulo || '(nenhum)'}
- Formato (resumo da pauta): ${formatoIdeia || `(livre: ${peca === 'reels' ? 'reels' : peca}${i.assunto?.tipo ? `, como o post de referência` : ''})`}
- Por que o público assiste: ${i.porQue || '(não informado)'}
${pergunta ? `\n## A pergunta que a pauta deixou para ${p.nome}\n\n${pergunta}\n\n**Resposta de ${p.nome}:** ${resposta ? resposta : '(não respondeu: escreva o roteiro completo sem essa história, do jeito descrito nas regras)'}\n` : resposta ? `\n## O que ${p.nome} contou sobre essa ideia\n\n${resposta}\n` : ''}
${fmt ? blocoFormato(fmt, duracao, imagens.length, mesmoPost, p.nome) : ''}
${!mesmoPost && i.assunto ? blocoAssunto(i.assunto) : ''}

## Território de ${p.nome}

${territorioTexto(t, p.nome)}

## Como ${p.nome} fala (a entrevista, nas palavras dele)

${entrevista}
${ultimo && pedido ? `\n## Versão anterior do roteiro\n\n${ultimo.texto || textoRoteiro(ultimo.conteudo)}\n\n## Ajuste pedido\n\n${pedido}\n\nReescreva aplicando o ajuste. Mantenha o que não foi pedido para mudar${fmt ? ', e continue no formato do post de referência' : ''}.\n` : ''}
## Regras

${regrasFormato}
- "fala": o texto INTEIRO que ${p.nome} vai falar, corrido, do começo ao fim, como a transcrição de um reels de verdade. Um parágrafo por ideia (ou por item, numa lista), sem títulos, sem "cena", sem tempos, sem direção entre parênteses, sem símbolos de marcação. Tem que soar como gente falando, não como texto escrito: frases curtas, conectivos de conversa ("olha", "e o pior", "sabe o que acontece?"), do jeito que ${p.nome} fala na entrevista. Num carrossel ou foto, cada parágrafo é o texto de um slide.
- A fala já começa com a melhor abertura e já termina com o fechamento. "ganchos": a abertura usada (a primeira frase da fala) e mais 1 ou 2 alternativas no MESMO tipo de gancho do post de referência, para ele trocar se quiser.
- "tom": UMA frase sobre como falar o vídeo inteiro (ex.: "conversa de amigo, rápido, sem pausa entre os itens; baixa o tom só na última frase").
- "gravacao": UMA sugestão rápida de como gravar, em 1 ou 2 frases, tirada do post de referência quando houver: enquadramento (selfie de perto, plano médio, de corpo inteiro), câmera parada ou na mão, para onde olhar, ritmo dos cortes. Ex.: "Selfie de perto, câmera na mão, olhando direto pra lente; um corte por item." É sugestão, não regra. Fora daqui, não fale de cenário, roupa, luz nem objetos do ambiente.
- "tela": os textos escritos que aparecem no vídeo, se o formato usa (o gancho escrito, o título de cada item), um por linha, curtos. Lista vazia se o formato não usa.
- "audio": a voz dele ("voz") ou a música/trend do post de referência ("musica" ou "voz+musica", com o nome do áudio) e, em "nota", como a fala casa com o áudio. Se o post usa um áudio em alta, use o MESMO.
- O roteiro sai PRONTO PARA GRAVAR: nada de lacuna, colchete ou "[PREENCHER]".
- SUBSTÂNCIA: quem assiste sai sabendo algo concreto. Se o post de referência tem pouco conteúdo, traga você mesmo, do seu conhecimento do assunto.
- Não invente acontecimento da vida de ${p.nome} (cliente, projeto, número, data, resultado que ele não contou). História pessoal só vem do território, da entrevista ou da resposta dele; sem ela, use exemplos típicos do assunto contados como observação ou opinião dele, e diga em "lembretes" onde ele pode trocar por um caso seu.
- Não copie frases do autor além da moldura do formato.
- "legenda": no estilo e no tamanho da legenda do post de referência${fmt ? '' : ' (primeira linha forte, 2 a 5 linhas curtas, no máximo 3 hashtags)'}.
- Nada da lista FORA.

## Formato da resposta

Responda SOMENTE com um bloco de código \`\`\`json, sem texto antes ou depois:

\`\`\`json
{
  "molde": "${fmt ? 'o esqueleto da fala do post de referência: sequência, padrão repetido, quantos itens, ritmo, tom, abertura, fechamento, áudio' : ''}",
  "formato": "ex.: reels falado, ~45s",
  "gravacao": "sugestão rápida de como gravar",
  "duracao_s": 45,
  "audio": { "tipo": "voz | musica | voz+musica", "nome": "nome do áudio, se for música/trend", "nota": "como a fala casa com o áudio" },
  "tom": "como falar o vídeo inteiro, numa frase",
  "fala": "o texto inteiro, corrido, um parágrafo por ideia",
  "ganchos": [{ "texto": "a abertura usada na fala", "entonacao": "" }, { "texto": "alternativa", "entonacao": "" }],
  "tela": ["texto escrito no vídeo (opcional)"],
  "legenda": "legenda do post",
  "lembretes": ["dica curta para a gravação (opcional)"]
}
\`\`\`
`
  return { prompt, resposta, pedido, imagens, formatoDe: fmt ? fmt.autor : null }
}

function guardarResposta(texto: string): string {
  try {
    const dir = resolve(process.cwd(), 'data', 'debug')
    mkdirSync(dir, { recursive: true })
    const arq = join(dir, `ia-roteiro-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`)
    writeFileSync(arq, texto, 'utf8')
    return arq
  } catch {
    return '(não salvei)'
  }
}

/** Le a resposta da IA e grava como nova versao. */
export async function aplicarRoteiro(ideiaId: string, texto: string, modelo: string, opts: { resposta?: string | null; pedido?: string | null; formatoDe?: string | null } = {}): Promise<RoteiroRow> {
  let bruto: unknown
  try {
    bruto = extrairJson(texto)
  } catch {
    throw new Error(`a IA não devolveu o roteiro em JSON. Resposta salva em ${guardarResposta(texto)}`)
  }
  const r = roteiroAnswer.safeParse(bruto)
  if (!r.success) {
    const arquivo = guardarResposta(texto)
    throw new Error(`a resposta da IA não veio no formato do roteiro (${r.error.issues[0]?.path.join('.')}: ${r.error.issues[0]?.message}). Resposta salva em ${arquivo}`)
  }
  const [i] = await db.select({ personaId: ideia.personaId }).from(ideia).where(eq(ideia.id, ideiaId)).limit(1)
  if (!i) throw new Error('ideia não encontrada')
  const versao = (db.all<{ v: number | null }>(sql`select max(versao) as v from roteiro where ideia_id = ${ideiaId}`)[0]?.v ?? 0) + 1
  await db.insert(roteiro).values({
    ideiaId,
    personaId: i.personaId,
    versao,
    resposta: opts.resposta ?? null,
    pedido: opts.pedido ?? null,
    conteudo: { ...r.data, formato_de: opts.formatoDe ?? r.data.formato_de ?? '' } as unknown as Record<string, unknown>,
    modelo,
  })
  return listarRoteiros(ideiaId)[0]!
}

/** Monta, chama a IA e grava. */
export async function gerarRoteiro(ideiaId: string, opts: OpcoesRoteiro = {}): Promise<RoteiroRow> {
  if (!temApi()) throw new Error('sem ANTHROPIC_API_KEY no .env: use "copiar prompt" e cole a resposta')
  const m = await montarRoteiro(ideiaId, opts)
  const { texto, modelo } = await perguntarLlm(m.prompt, { modelo: modeloPauta(), maxTokens: 12_000, imagens: m.imagens })
  return aplicarRoteiro(ideiaId, texto, modelo, { resposta: m.resposta, pedido: m.pedido, formatoDe: m.formatoDe })
}

/**
 * Grava a edicao feita no painel como uma versao nova (a versao da IA fica no
 * historico). Molde, formato copiado e resposta vem da versao que foi editada.
 */
export async function salvarEdicao(ideiaId: string, baseId: string, bruto: unknown): Promise<RoteiroRow> {
  const base = listarRoteiros(ideiaId).find((r) => r.id === baseId)
  if (!base) throw new Error('versão de base não encontrada')
  const entrada = (bruto && typeof bruto === 'object' ? bruto : {}) as Record<string, unknown>
  // a fala editada substitui as cenas antigas
  const r = roteiroAnswer.safeParse({ ...base.conteudo, ...entrada, blocos: [], molde: base.conteudo.molde, formato_de: base.conteudo.formato_de })
  if (!r.success) {
    const campo = r.error.issues[0]?.path.join('.')
    throw new Error(campo === 'ganchos' ? 'deixe pelo menos uma abertura' : campo === 'fala' ? 'o roteiro está vazio' : `edição inválida: ${r.error.issues[0]?.message}`)
  }
  const [i] = await db.select({ personaId: ideia.personaId }).from(ideia).where(eq(ideia.id, ideiaId)).limit(1)
  if (!i) throw new Error('ideia não encontrada')
  const versao = (db.all<{ v: number | null }>(sql`select max(versao) as v from roteiro where ideia_id = ${ideiaId}`)[0]?.v ?? 0) + 1
  await db.insert(roteiro).values({
    ideiaId,
    personaId: i.personaId,
    versao,
    resposta: base.resposta,
    pedido: `editado por você (a partir da v${base.versao})`,
    conteudo: r.data as unknown as Record<string, unknown>,
    status: base.status,
    modelo: 'você',
  })
  return listarRoteiros(ideiaId)[0]!
}

/** Apaga todas as versoes do roteiro de uma ideia, para comecar do zero. */
export async function apagarRoteiros(ideiaId: string): Promise<number> {
  const apagados = await db.delete(roteiro).where(eq(roteiro.ideiaId, ideiaId)).returning({ id: roteiro.id })
  return apagados.length
}

export async function editarRoteiro(id: string, texto: string): Promise<void> {
  await db.update(roteiro).set({ texto: texto.trim() || null }).where(eq(roteiro.id, id))
}

export async function marcarRoteiro(id: string, status: 'rascunho' | 'gravado'): Promise<void> {
  await db.update(roteiro).set({ status }).where(eq(roteiro.id, id))
  // gravar um roteiro e o mesmo que dizer "vou postar" para a ideia
  if (status === 'gravado') {
    const [r] = await db.select({ ideiaId: roteiro.ideiaId }).from(roteiro).where(eq(roteiro.id, id)).limit(1)
    if (r) await db.update(ideia).set({ status: 'aceita', feedbackAt: new Date() }).where(and(eq(ideia.id, r.ideiaId), eq(ideia.status, 'nova')))
  }
}

