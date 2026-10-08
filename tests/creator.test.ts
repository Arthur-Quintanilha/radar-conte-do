import { describe, expect, it } from 'vitest'
import { alcance, chaveTema, desempenhoRelativo, engajamento, mediana, pontuarPosts } from '../src/creator/score'
import { extractFollowing, sementeDaPagina } from '../src/parser/following'
import { classify } from '../src/collector/interceptor'
import { minimoSementes } from '../src/creator/grafo'
import { contaAnswer, encaixeAnswer, ideiaAnswer, territorio } from '../src/creator/tipos'
import { foraDaEntrevista, normalizarUsername } from '../src/creator/persona'
import { agruparRadar, semanaDe, type Candidata } from '../src/creator/pauta'

describe('regua da pauta', () => {
  it('mediana', () => {
    expect(mediana([3, 1, 2])).toBe(2)
    expect(mediana([4, 1, 2, 3])).toBe(2.5)
    expect(mediana([])).toBeNull()
  })
  it('engajamento some quando as curtidas estao escondidas', () => {
    expect(engajamento(100, 5)).toBe(105)
    expect(engajamento(null, 5)).toBeNull()
  })
  it('desempenho relativo ao proprio autor, neutro sem historico', () => {
    expect(desempenhoRelativo(300, [100, 100, 100])).toBe(3)
    expect(desempenhoRelativo(300, [100, 100])).toBe(1)
    expect(desempenhoRelativo(10_000, [100, 100, 100])).toBe(5)
    expect(desempenhoRelativo(1, [100, 100, 100])).toBe(0.2)
  })
  it('conta pequena seguida por muitas sementes ganha de conta grande seguida por poucas', () => {
    const hist = new Map([
      ['pequena', [100, 100, 100, 100]],
      ['gigante', [100_000, 100_000, 100_000, 100_000]],
    ])
    const sementes = new Map([
      ['pequena', 5],
      ['gigante', 1],
    ])
    const r = pontuarPosts(
      [
        { postId: 'g', autor: 'gigante', likes: 150_000, comments: 0, confianca: 0.8 },
        { postId: 'p', autor: 'pequena', likes: 150, comments: 0, confianca: 0.8 },
      ],
      hist,
      sementes,
      10,
    )
    expect(r[0]?.postId).toBe('p')
    expect(alcance(5, 10)).toBe(0.5)
  })
  it('chaveTema junta variacoes', () => {
    expect(chaveTema('Corridas ')).toBe(chaveTema('corrida'))
    expect(chaveTema('Paternidade!')).toBe('paternidade')
  })
})

describe('lista de seguindo', () => {
  it('reconhece o endpoint', () => {
    expect(classify('https://www.instagram.com/api/v1/friendships/123/following/?count=12')).toBe('following')
    expect(classify('https://www.instagram.com/api/v1/friendships/123/followers/?count=12')).toBeNull()
  })
  it('dona da lista vem da pagina', () => {
    expect(sementeDaPagina('https://www.instagram.com/Fulano.X/following/')).toBe('fulano.x')
    expect(sementeDaPagina('https://www.instagram.com/fulano/')).toBeNull()
    expect(sementeDaPagina('https://www.instagram.com/fulano/', 'following')).toBe('fulano')
    expect(sementeDaPagina('https://www.instagram.com/explore/', 'following')).toBeNull()
    expect(sementeDaPagina('https://www.instagram.com/fulano/reels/', 'following')).toBeNull()
    expect(sementeDaPagina('https://www.instagram.com/fulano/followers/')).toBeNull()
    expect(sementeDaPagina(null)).toBeNull()
  })
  it('REST: users na raiz', () => {
    const r = extractFollowing({ users: [{ pk: 1, username: 'A.b', full_name: 'A', is_private: false }, { pk: 2 }], next_max_id: '12' }, true)
    expect(r).toEqual([{ igUserId: '1', username: 'a.b', fullName: 'A', isVerified: null, isPrivate: false }])
  })
  it('graphql: so o que esta debaixo de follow, nunca seguidos em comum nem sugestoes', () => {
    const body = {
      data: {
        user: {
          edge_follow: { edges: [{ node: { id: '1', username: 'certo' } }] },
          edge_mutual_followed_by: { edges: [{ node: { id: '2', username: 'mutuo' } }] },
          edge_chaining: { edges: [{ node: { id: '3', username: 'sugestao' } }] },
        },
        xdt_api__v1__discover__chaining: { users: [{ pk: 4, username: 'outra_sugestao' }] },
      },
    }
    expect(extractFollowing(body).map((u) => u.username)).toEqual(['certo'])
  })
})

describe('grafo', () => {
  it('minimo automatico: 30% das sementes, pelo menos 2', () => {
    expect(minimoSementes(1, 0)).toBe(1)
    expect(minimoSementes(3, 0)).toBe(2)
    expect(minimoSementes(10, 0)).toBe(3)
    expect(minimoSementes(30, 0)).toBe(9)
    expect(minimoSementes(10, 4)).toBe(4)
    expect(minimoSementes(2, 4)).toBe(2)
  })
})

describe('respostas da IA', () => {
  it('conta: papel com acento e maiuscula, par sem tema', () => {
    const r = contaAnswer.parse({ id: '@x', papel: 'Consumido', confianca: '80%', motivo: 'bio' })
    expect(r.papel).toBe('consumido')
    expect(r.confianca).toBeCloseTo(0.8)
    expect(r.candidata_semente).toBe(false)
    expect(contaAnswer.safeParse({ id: '@x', papel: 'concorrente', confianca: 1, motivo: 'x' }).success).toBe(false)
  })
  it('encaixe aceita campos nulos', () => {
    const r = encaixeAnswer.parse({ id: 'ABC', encaixe: 'Radar', radar_tema: 'corrida', angulo: null, confianca: 0.7, motivo: 'x' })
    expect(r.encaixe).toBe('radar')
  })
  it('ideia exige angulo', () => {
    expect(ideiaAnswer.safeParse({ post_id: 'A', titulo: 't', angulo: '' }).success).toBe(false)
  })
  it('territorio preenche listas vazias', () => {
    const t = territorio.parse({ resumo: 'x' })
    expect(t.temas).toEqual([])
    expect(t.fora).toEqual([])
  })
})

describe('persona', () => {
  it('fora sai da entrevista, uma linha por tema', () => {
    expect(foraDaEntrevista({ fora: '- política\n• religião; futebol\n\n' })).toEqual(['política', 'religião', 'futebol'])
    expect(foraDaEntrevista({ fora: 'Política;\nEsportes,' })).toEqual(['Política', 'Esportes'])
    expect(foraDaEntrevista({ fora: 'política, religião, futebol.' })).toEqual(['política', 'religião', 'futebol'])
  })
  it('aceita @, nome ou link', () => {
    expect(normalizarUsername('@Fulano')).toBe('fulano')
    expect(normalizarUsername('https://www.instagram.com/fulano.x/?hl=pt')).toBe('fulano.x')
  })
  it('semana ISO com dois digitos', () => {
    expect(semanaDe(new Date('2026-01-07T12:00:00Z'))).toBe('2026-W02')
    expect(semanaDe(new Date('2026-09-30T12:00:00Z'))).toBe('2026-W40')
  })
})

describe('radar', () => {
  const c = (id: string, autor: string, tema: string, score: number): Candidata =>
    ({ postId: id, autor, radarTema: tema, score, post: {} as Candidata['post'] }) as Candidata
  it('agrupa por tema, exclui o que ja esta no territorio e ignora post solto', () => {
    const r = agruparRadar(
      [c('1', 'a', 'Corrida', 1), c('2', 'b', 'corridas', 2), c('3', 'a', 'vinho', 5), c('4', 'c', 'MVP', 3), c('5', 'd', 'mvp', 3)],
      new Set([chaveTema('mvp')]),
      new Map([
        ['a', new Set(['s1', 's2'])],
        ['b', new Set(['s2', 's3'])],
      ]),
    )
    expect(r.map((g) => g.chave)).toEqual([chaveTema('corrida')])
    expect(r[0]?.sementes).toBe(3)
    expect(r[0]?.autores).toBe(2)
  })
})

describe('variedade da pauta', () => {
  const c = (id: string, autor: string, score: number) => ({ postId: id, autor, score, post: {} }) as unknown as Candidata
  it('uma ideia por autor, e autor recente vai para o fim', async () => {
    const { diversificar } = await import('../src/creator/pauta')
    const lista = [c('1', 'gui', 9), c('2', 'gui', 8), c('3', 'gui', 7), c('4', 'ana', 5), c('5', 'bia', 4), c('6', 'caio', 3)]
    expect(diversificar(lista, new Map(), new Set(), 14, 3).map((x) => x.postId)).toEqual(['1', '4', '5', '6'])
    expect(diversificar(lista, new Map(), new Set(['gui']), 14, 3).map((x) => x.postId)).toEqual(['4', '1', '5', '6'])
    expect(diversificar(lista, new Map([['ana', 1]]), new Set(), 14, 3).map((x) => x.postId)).toEqual(['1', '5', '6'])
  })
  it('sem variedade suficiente, libera mais de um post por autor', async () => {
    const { diversificar } = await import('../src/creator/pauta')
    const lista = [c('1', 'gui', 9), c('2', 'gui', 8), c('3', 'gui', 7)]
    expect(diversificar(lista, new Map(), new Set(), 14, 2).map((x) => x.postId)).toEqual(['1', '2'])
  })
})

describe('roteiro', () => {
  it('acha a pergunta deixada no angulo', async () => {
    const { perguntaDoAngulo } = await import('../src/creator/roteiro')
    expect(perguntaDoAngulo('Conectar com a opiniao dele. Pergunta para o Lucas: qual cliente quis IA antes de ter processo?')).toBe('qual cliente quis IA antes de ter processo?')
    expect(perguntaDoAngulo('Contar a historia do MVP.')).toBeNull()
    expect(perguntaDoAngulo(null)).toBeNull()
  })
  it('tipo de peca a partir do formato livre', async () => {
    const { tipoDePeca } = await import('../src/creator/roteiro')
    expect(tipoDePeca('reels_fala de ~40s abrindo com negacao')).toBe('reels')
    expect(tipoDePeca('Carrossel de 7 slides')).toBe('carrossel')
    expect(tipoDePeca('foto_legenda')).toBe('foto')
    expect(tipoDePeca(null)).toBe('reels')
  })
  it('aceita a resposta da IA e vira texto corrido', async () => {
    const { roteiroAnswer } = await import('../src/creator/tipos')
    const { textoRoteiro } = await import('../src/creator/roteiro')
    const r = roteiroAnswer.parse({
      formato: 'reels falado',
      duracao_s: '45s',
      ganchos: ['Não, a IA não vai salvar sua empresa.', 'IA em empresa bagunçada só acelera a bagunça.'],
      blocos: [
        { parte: 'gancho', tempo: '0–3s', fala: 'Não, a IA não vai salvar sua empresa.', tela: 'IA ≠ salvação', visual: null },
        { parte: 'história', tempo: '3–20s', fala: 'Um cliente [PREENCHER: qual] chegou pedindo IA...' },
      ],
      legenda: 'Antes da IA, o processo.',
    })
    expect(r.duracao_s).toBe(45)
    expect(r.cta).toBe('')
    expect(r.blocos[1]!.tela).toBe('')
    const t = textoRoteiro(r)
    expect(t).toContain('Não, a IA não vai salvar sua empresa.\n\nUm cliente')
    expect(t).toContain('TEXTO NA TELA\n- IA ≠ salvação')
    expect(t).toContain('OUTRAS ABERTURAS')
    expect(t).toContain('LEGENDA\nAntes da IA, o processo.')
  })
  it('recusa roteiro sem gancho ou sem fala', async () => {
    const { roteiroAnswer } = await import('../src/creator/tipos')
    expect(roteiroAnswer.safeParse({ ganchos: [], blocos: [{ fala: 'x' }], legenda: '' }).success).toBe(false)
    expect(roteiroAnswer.safeParse({ ganchos: ['x'], blocos: [], legenda: '' }).success).toBe(false)
  })
})

describe('formato do roteiro', () => {
  it('le a duracao do cabecalho do ffmpeg e escolhe os momentos dos quadros', async () => {
    const { duracaoDoCabecalho, momentos } = await import('../src/enricher/quadros')
    expect(duracaoDoCabecalho('  Duration: 00:00:41.23, start: 0.000000, bitrate: 1200 kb/s')).toBeCloseTo(41.23)
    expect(duracaoDoCabecalho('nada')).toBeNull()
    const m = momentos(40, 6)
    expect(m[0]).toBe(0.5)
    expect(m).toHaveLength(6)
    expect(Math.max(...m)).toBeLessThan(40)
  })
  it('copia o formato do formato sugerido, ou do proprio post quando ele rendeu', async () => {
    const { postDoFormato } = await import('../src/creator/roteiro')
    const post = (desempenho: number | null) => ({ desempenho }) as never
    const bom = post(5), ruim = post(0.4), ref = post(2)
    expect(postDoFormato(bom, null)).toBe(bom)
    expect(postDoFormato(ruim, ref)).toBe(ref)
    expect(postDoFormato(ruim, null)).toBeNull()
    expect(postDoFormato(post(null), null)).not.toBeNull()
  })
})

describe('roteiro tolerante', () => {
  it('corta o que passa do tamanho e converte molde em objeto, em vez de recusar', async () => {
    const { roteiroAnswer } = await import('../src/creator/tipos')
    const r = roteiroAnswer.parse({
      molde: { batidas: ['gancho 0-3s', 'item 1'], audio: 'original' },
      formato: 'x'.repeat(500),
      ganchos: 'só um gancho',
      blocos: [{ parte: 'item 1', tempo: 3, fala: 'y'.repeat(4000) }],
      lembretes: null,
    })
    expect(r.molde).toContain('batidas: gancho 0-3s')
    expect(r.formato).toHaveLength(300)
    expect(r.ganchos).toEqual([{ texto: 'só um gancho', entonacao: '' }])
    expect(r.blocos[0]!.tempo).toBe('3')
    expect(r.blocos[0]!.fala).toHaveLength(3000)
    expect(r.lembretes).toEqual([])
  })
})

describe('roteiro de fala', () => {
  it('aceita ganchos com entonacao, audio e converte "visual" antigo em "acao"', async () => {
    const { roteiroAnswer } = await import('../src/creator/tipos')
    const { textoRoteiro, textoParaLer } = await import('../src/creator/roteiro')
    const r = roteiroAnswer.parse({
      audio: { tipo: 'musica', nome: 'Espresso - trend', nota: 'cada item cai numa batida' },
      gravacao: 'Selfie de perto, um corte por item.',
      ganchos: [{ texto: 'Esses livros me fizeram dev.', entonacao: 'firme' }, 'outro gancho'],
      blocos: [
        { tempo: '0–2s', parte: 'gancho', fala: 'Esses livros / me fizeram *dev*.', entonacao: 'firme' },
        { tempo: '2–8s', fala: 'Um livro pra quem tá começando.', visual: 'mostra a capa' },
      ],
    })
    expect(r.ganchos[1]).toEqual({ texto: 'outro gancho', entonacao: '' })
    expect(r.blocos[1]!.acao).toBe('mostra a capa')
    expect(r.audio.nome).toBe('Espresso - trend')
    const t = textoRoteiro(r)
    expect(t).toContain('ÁUDIO: musica: Espresso - trend')
    expect(t).toContain('COMO GRAVAR (sugestão): Selfie de perto, um corte por item.')
    expect(t).toContain('ROTEIRO')
    expect(textoParaLer(r)).toBe('Esses livros / me fizeram *dev*.\n\nUm livro pra quem tá começando.')
    const novo = roteiroAnswer.parse({ fala: 'Primeira frase. Segunda.\n\nOutro parágrafo.', ganchos: ['Primeira frase.'], tom: 'conversa de amigo' })
    expect(textoRoteiro(novo)).toContain('(conversa de amigo)\n\nPrimeira frase. Segunda.\n\nOutro parágrafo.')
    expect(roteiroAnswer.safeParse({ ganchos: ['x'] }).success).toBe(false)
  })
})
